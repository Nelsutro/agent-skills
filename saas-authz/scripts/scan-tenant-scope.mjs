#!/usr/bin/env node
/**
 * Flag tenant-owned database access that looks unscoped.
 *
 * Usage:
 *   node scripts/scan-tenant-scope.mjs [paths...] [--json] [--window 12]
 *                                     [--allow users,sessions] [--fail-on-match]
 *
 * Heuristic: for known Prisma/Drizzle/Supabase/raw-SQL calls, inspect the call
 * and the next N lines for a tenant marker (tenantId, organizationId, ctx.tenant,
 * withTenant, etc.). If none is present, report a candidate.
 *
 * This is an audit aid. A tenant-scoped repository or ORM extension may inject the
 * filter outside the call site. Mark those lines with `// tenant-scoped` to suppress.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const DEFAULT_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', 'vendor',
])
const TEST_FILE = /(?:^|[\\/])(?:__tests__|__mocks__)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$/

const DEFAULT_GLOBAL = [
  'users', 'user', 'sessions', 'session', 'verificationtokens', 'verification_tokens',
  'accounts', 'account', 'migrations', '_prismamigrations', 'schema_migrations',
  'countries', 'currencies', 'plans', 'features', 'permissions', 'roles',
]

const TENANT_MARKER = new RegExp(
  [
    'tenantId', 'tenant_id', 'tenantID', 'organizationId', 'organization_id',
    'orgId', 'org_id', 'workspaceId', 'workspace_id', 'accountId', 'account_id',
    'withTenant', 'forTenant', 'tenantScope', 'tenantFilter', 'currentTenant',
    'ctx\\.tenant', 'requireTenant', 'activeTenant', 'membership',
  ].join('|'),
)
const SUPPRESS = /tenant-scoped|tenant scoped|authz-ignore|tenant-ok/i

const PRISMA = /\b(db|prisma|tx|trx|client|database)\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*(findMany|findFirst|findUniqueOrThrow|findUnique|findFirstOrThrow|updateMany|update|deleteMany|delete|upsert|count|aggregate|groupBy|createMany|create)\s*\(/g
const DRIZZLE = /\b(db|tx|client|database)\s*\.\s*(select|update|delete|insert)\s*\(/g
const SUPABASE = /\b(supabase|client)\s*\.\s*from\(\s*['"`]([\w.]+)['"`]\s*\)/g
const RAW = /\b(db|prisma|client|sql)\s*\.\s*(\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe)\b/
const SQL_FROM = /\b(?:from|into|update)\s+["`]?([A-Za-z_][\w.]*)["`]?/i

function parseArgs(argv) {
  const args = {
    paths: [],
    json: false,
    window: 12,
    allow: [...DEFAULT_GLOBAL],
    failOnMatch: false,
    includeTests: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--window') args.window = Math.max(1, Number(argv[++i]) || 12)
    else if (a === '--allow') args.allow = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--fail-on-match') args.failOnMatch = true
    else if (a === '--include-tests') args.includeTests = true
    else if (a === '-h' || a === '--help') args.help = true
    else if (!a.startsWith('-')) args.paths.push(a)
  }
  if (args.paths.length === 0) args.paths.push('.')
  return args
}

function walk(target, args, out = []) {
  let stat
  try {
    stat = statSync(target)
  } catch {
    return out
  }
  if (stat.isFile()) {
    if (DEFAULT_EXT.includes(extname(target).toLowerCase())) out.push(target)
    return out
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(target, entry.name), args, out)
    } else if (entry.isFile()) {
      if (!DEFAULT_EXT.includes(extname(entry.name).toLowerCase())) continue
      const full = join(target, entry.name)
      if (!args.includeTests && TEST_FILE.test(full)) continue
      out.push(full)
    }
  }
  return out
}

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/["'`]/g, '')
    .split('.')
    .pop()
}

function isGlobal(name, allow) {
  if (!name) return false
  const norm = normalize(name)
  const singular = norm.replace(/ies$/, 'y').replace(/s$/, '')
  return allow.some((entry) => {
    const e = normalize(entry)
    const es = e.replace(/ies$/, 'y').replace(/s$/, '')
    return e === norm || es === singular
  })
}

function severity(op) {
  return /delete|update|upsert|insert|create|execute/.test(op) ? 'write' : 'read'
}

function scanFile(file, root, args) {
  const findings = []
  let lines
  try {
    if (statSync(file).size > 2_000_000) return findings
    lines = readFileSync(file, 'utf8').split(/\r?\n/)
  } catch {
    return findings
  }

  const seen = new Set()
  const add = (index, column, rule, table, op) => {
    const key = `${index}:${rule}:${table}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({
      file: relative(root, file) || file,
      line: index + 1,
      column: column + 1,
      rule,
      table: table || null,
      severity: severity(op),
      snippet: lines[index].trim().slice(0, 140),
    })
  }

  lines.forEach((line, index) => {
    const suppressed =
      SUPPRESS.test(line) ||
      (lines[index - 1] && SUPPRESS.test(lines[index - 1])) ||
      (lines[index - 2] && SUPPRESS.test(lines[index - 2]))
    if (suppressed) return

    const windowText = lines.slice(index, index + args.window).join('\n')
    const hasMarker = TENANT_MARKER.test(windowText)

    for (const [regex, kind] of [[PRISMA, 'prisma'], [DRIZZLE, 'drizzle'], [SUPABASE, 'supabase']]) {
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(line)) !== null) {
        let table = null
        let op = kind
        if (kind === 'prisma') {
          table = match[2]
          op = match[3]
        } else if (kind === 'drizzle') {
          op = match[2]
          const from = windowText.match(/\.from\(\s*([A-Za-z_$][\w$]*)/)
          table = from ? from[1] : null
        } else {
          table = match[2]
          op = 'from'
        }
        if (isGlobal(table, args.allow)) continue
        if (hasMarker) continue
        add(index, match.index, kind, table, op)
      }
    }

    if (RAW.test(line)) {
      const block = lines.slice(index, index + Math.max(args.window, 16)).join('\n')
      const marker = TENANT_MARKER.test(block)
      const tableMatch = block.match(SQL_FROM)
      const table = tableMatch ? tableMatch[1] : null
      if (!marker && !isGlobal(table, args.allow)) {
        const op = line.includes('$executeRaw') ? 'execute' : 'raw'
        add(index, line.indexOf('$'), 'raw', table, op)
      }
    }
  })

  return findings
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/scan-tenant-scope.mjs [paths...] [--json] [--window 12] [--allow users,sessions] [--fail-on-match]')
    process.exit(0)
  }

  const cwd = process.cwd()
  const files = []
  for (const target of args.paths) {
    for (const file of walk(resolve(target), args)) {
      if (!files.includes(file)) files.push(file)
    }
  }

  const findings = files.flatMap((file) => scanFile(file, cwd, args))
  const byFile = new Map()
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, [])
    byFile.get(finding.file).push(finding)
  }

  if (args.json) {
    console.log(JSON.stringify({ scanned: files.length, findings }, null, 2))
  } else {
    for (const [file, items] of byFile) {
      console.log(`\n${file}`)
      for (const item of items) {
        const table = item.table ? ` ${item.table}` : ''
        console.log(`  ${item.line}:${item.column}  [${item.severity}] ${item.rule}${table}  ${item.snippet}`)
      }
    }
    console.log('')
    console.log(`Scanned ${files.length} file(s); ${findings.length} candidate(s) in ${byFile.size} file(s).`)
    if (findings.length > 0) {
      console.log('Review each call: repository helpers and ORM extensions may inject the tenant outside the call site.')
      console.log('Mark verified calls with `// tenant-scoped` to suppress them.')
    }
  }

  if (args.failOnMatch && findings.length > 0) process.exitCode = 1
}

main()
