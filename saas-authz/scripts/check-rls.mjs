#!/usr/bin/env node
/**
 * Check SQL migrations for row-level security coverage.
 *
 * Usage:
 *   node scripts/check-rls.mjs [dir] [--global countries,currencies] [--strict] [--json]
 *
 * Checks:
 *   - every non-global table has RLS enabled
 *   - RLS is FORCEd (warning)
 *   - every table with policies has RLS enabled
 *   - policies do not use `USING (true)` / `WITH CHECK (true)`
 *   - policies contain a tenant/user predicate (warning)
 *   - DISABLE ROW LEVEL SECURITY is reported as an error
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor'])
const DEFAULT_GLOBAL = [
  '_prisma_migrations', 'schema_migrations', 'migrations', 'pgmigrations',
  'knex_migrations', 'sequelize_meta', 'countries', 'currencies', 'plans',
  'features', 'permissions',
]

const CREATE_TABLE = /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"(?:\."[^"]+")?|[A-Za-z_][\w.]*)/gi
const ALTER_RLS = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?("[^"]+"(?:\."[^"]+")?|[A-Za-z_][\w.]*)\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi
const CREATE_POLICY = /\bCREATE\s+POLICY\s+("[^"]+"|[A-Za-z_][\w]*)\s+ON\s+("[^"]+"(?:\."[^"]+")?|[A-Za-z_][\w.]*)([\s\S]*?);/gi
const PERMISSIVE = /\b(?:USING|WITH\s+CHECK)\s*\(\s*true\s*\)/i
const PREDICATE = /current_setting|auth\.(?:uid|jwt|role)|tenant_id|tenantId|organization_id|org_id|workspace_id|account_id|user_id|owner_id|membership|app\.tenant/i

function parseArgs(argv) {
  const args = { dir: null, global: [...DEFAULT_GLOBAL], strict: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--global') args.global = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--strict') args.strict = true
    else if (a === '--json') args.json = true
    else if (a === '-h' || a === '--help') args.help = true
    else if (!a.startsWith('-') && !args.dir) args.dir = a
  }
  return args
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out)
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.sql') {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
}

function unquote(name) {
  return name.replace(/"/g, '')
}

function keyOf(name) {
  return unquote(name).toLowerCase().split('.').pop()
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function ensure(tables, name, file, line) {
  const key = keyOf(name)
  if (!tables.has(key)) {
    tables.set(key, {
      key,
      name: unquote(name),
      file,
      line,
      rls: false,
      force: false,
      disabled: false,
      policies: [],
    })
  }
  return tables.get(key)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/check-rls.mjs [dir] [--global countries,currencies] [--strict] [--json]')
    process.exit(0)
  }

  const root = resolve(args.dir || '.')
  let stat
  try {
    stat = statSync(root)
  } catch {
    console.error(`Not found: ${root}`)
    process.exit(2)
  }
  const files = stat.isDirectory() ? walk(root) : [root]
  if (files.length === 0) {
    console.error(`No .sql files found in ${root}`)
    process.exit(2)
  }

  const tables = new Map()
  const errors = []
  const warnings = []

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const sql = stripComments(raw)
    const rel = relative(process.cwd(), file) || file

    for (const match of sql.matchAll(CREATE_TABLE)) {
      ensure(tables, match[1], rel, lineOf(sql, match.index))
    }

    for (const match of sql.matchAll(ALTER_RLS)) {
      const table = ensure(tables, match[1], rel, lineOf(sql, match.index))
      const action = match[2].toUpperCase().replace(/\s+/g, ' ')
      if (action === 'ENABLE') table.rls = true
      else if (action === 'DISABLE') {
        table.rls = false
        table.disabled = true
      } else if (action === 'FORCE') table.force = true
      else if (action === 'NO FORCE') table.force = false
    }

    for (const match of sql.matchAll(CREATE_POLICY)) {
      const table = ensure(tables, match[2], rel, lineOf(sql, match.index))
      table.policies.push({
        name: unquote(match[1]),
        body: match[3],
        file: rel,
        line: lineOf(sql, match.index),
      })
    }
  }

  const globalSet = new Set(args.global.map(keyOf))
  const rows = []

  for (const table of tables.values()) {
    if (globalSet.has(table.key)) continue

    if (table.disabled) {
      errors.push({ table: table.name, file: table.file, line: table.line, message: 'RLS is disabled by a migration' })
    }
    if (table.policies.length > 0 && !table.rls) {
      errors.push({ table: table.name, file: table.file, line: table.line, message: 'policies exist but RLS is not enabled' })
    } else if (!table.rls) {
      errors.push({ table: table.name, file: table.file, line: table.line, message: 'RLS is not enabled' })
    }

    if (table.rls && !table.force) {
      warnings.push({
        table: table.name,
        file: table.file,
        line: table.line,
        message: 'RLS is not forced; the table owner bypasses it',
      })
    }

    if (table.rls && table.policies.length === 0) {
      warnings.push({
        table: table.name,
        file: table.file,
        line: table.line,
        message: 'RLS enabled with no policy (deny-all until a policy is added)',
      })
    }

    for (const policy of table.policies) {
      if (PERMISSIVE.test(policy.body)) {
        errors.push({
          table: table.name,
          policy: policy.name,
          file: policy.file,
          line: policy.line,
          message: `policy "${policy.name}" allows every row (USING/WITH CHECK true)`,
        })
      } else if (!PREDICATE.test(policy.body)) {
        warnings.push({
          table: table.name,
          policy: policy.name,
          file: policy.file,
          line: policy.line,
          message: `policy "${policy.name}" has no tenant/user predicate`,
        })
      }
    }

    rows.push({ table: table.name, rls: table.rls, force: table.force, policies: table.policies.length })
  }

  if (args.json) {
    console.log(JSON.stringify({ root, files: files.length, tables: rows, errors, warnings }, null, 2))
  } else {
    for (const item of errors) {
      const where = `${item.file}:${item.line}`
      console.log(`ERROR  ${item.table}  ${item.message}  (${where})`)
    }
    for (const item of warnings) {
      const where = `${item.file}:${item.line}`
      console.log(`WARN   ${item.table}  ${item.message}  (${where})`)
    }
    console.log('')
    console.log(`Scanned ${files.length} SQL file(s); ${rows.length} table(s) checked.`)
    console.log(`Result: ${errors.length} error(s), ${warnings.length} warning(s)`)
  }

  if (errors.length > 0 || (args.strict && warnings.length > 0)) process.exitCode = 1
}

main()
