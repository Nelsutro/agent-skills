#!/usr/bin/env node
/**
 * Validate translation catalogs without third-party dependencies.
 *
 * Usage:
 *   node scripts/check-locales.mjs [dir] [--base en] [--strict] [--json]
 *
 * Supports both layouts:
 *   locales/en.json              -> locale "en", namespace "(root)"
 *   messages/en/common.json      -> locale "en", namespace "common"
 *
 * Checks:
 *   - missing / extra keys per namespace
 *   - empty values
 *   - ICU syntax: balanced braces, plural/selectordinal has an "other" branch
 *   - placeholder (argument) parity with the base locale
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

let parseIcu = null
try {
  ;({ parse: parseIcu } = await import('@formatjs/icu-messageformat-parser'))
} catch {
  // Optional: the script works without it, using a built-in structural check.
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build'])

function parseArgs(argv) {
  const args = { dir: null, base: 'en', strict: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
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
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function flatten(value, prefix = '', out = {}) {
  for (const [key, val] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (val && typeof val === 'object' && !Array.isArray(val)) flatten(val, full, out)
    else out[full] = Array.isArray(val) ? JSON.stringify(val) : val
  }
  return out
}

function matchBrace(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'") {
      if (text[i + 1] === "'") {
        i++
        continue
      }
      if (text[i + 1] === '{' || text[i + 1] === '}' || text[i + 1] === '#') {
        i += 2
        while (i < text.length && text[i] !== "'") i++
        continue
      }
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
      if (depth < 0) return -1
    }
  }
  return -1
}

const HEADER = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([a-z]+)\s*(?:,\s*([\s\S]*))?)?$/

function scanBranches(rest, out) {
  let i = 0
  while (i < rest.length) {
    const open = rest.indexOf('{', i)
    if (open === -1) break
    const end = matchBrace(rest, open)
    if (end === -1) break
    collectArgs(rest.slice(open + 1, end), out)
    i = end + 1
  }
}

function collectArgs(message, out = new Set()) {
  for (let i = 0; i < message.length; i++) {
    const ch = message[i]
    if (ch === "'") {
      if (message[i + 1] === "'") {
        i++
        continue
      }
      if (message[i + 1] === '{' || message[i + 1] === '}' || message[i + 1] === '#') {
        i += 2
        while (i < message.length && message[i] !== "'") i++
      }
      continue
    }
    if (ch !== '{') continue
    const end = matchBrace(message, i)
    if (end === -1) break
    const header = message.slice(i + 1, end).match(HEADER)
    if (header) {
      const [, name, type, rest] = header
      out.add(name)
      if (type === 'plural' || type === 'selectordinal' || type === 'select') {
        scanBranches(rest ?? '', out)
      }
    }
    i = end
  }
  return out
}

function validateMessage(message, errors = [], depth = 0) {
  if (typeof message !== 'string') {
    return [`value is not a string (${typeof message})`]
  }
  if (depth === 0 && message.trim() === '') errors.push('empty value')
  if (depth === 0 && parseIcu) {
    try {
      parseIcu(message, { requiresOtherClause: true })
    } catch (err) {
      errors.push(`ICU parse error: ${err.message}`)
    }
  }

  for (let i = 0; i < message.length; i++) {
    if (message[i] !== '{') continue
    const end = matchBrace(message, i)
    if (end === -1) {
      errors.push(`unbalanced "{" at column ${i + 1}`)
      break
    }
    const inner = message.slice(i + 1, end)
    const header = inner.match(HEADER)
    if (header && (header[2] === 'plural' || header[2] === 'selectordinal')) {
      const rest = header[3] ?? ''
      if (!/(?:^|[\s,])other\s*\{/.test(rest)) {
        errors.push(`"${header[2]}" message is missing an "other" branch`)
      }
      let cursor = 0
      while (true) {
        const open = rest.indexOf('{', cursor)
        if (open === -1) break
        const close = matchBrace(rest, open)
        if (close === -1) break
        validateMessage(rest.slice(open + 1, close), errors, depth + 1)
        cursor = close + 1
      }
    }
    i = end
  }
  return [...new Set(errors)]
}

function inferKey(root, file) {
  const parts = relative(root, file).split(sep)
  if (parts.length === 1) {
    return { locale: basename(file, '.json'), namespace: '(root)' }
  }
  return {
    locale: parts[0],
    namespace: parts.slice(1).join('/').replace(/\.json$/i, ''),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/check-locales.mjs [dir] [--base en] [--strict] [--json]')
    process.exit(0)
  }

  const root = resolve(args.dir || 'locales')
  let stat
  try {
    stat = statSync(root)
  } catch {
    console.error(`Directory not found: ${root}`)
    process.exit(2)
  }
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${root}`)
    process.exit(2)
  }

  const files = walk(root)
  if (files.length === 0) {
    console.error(`No JSON catalogs found in ${root}`)
    process.exit(2)
  }

  /** @type {Map<string, Map<string, {file: string, flat: Record<string, unknown>}>>} */
  const catalogs = new Map()
  for (const file of files) {
    const { locale, namespace } = inferKey(root, file)
    if (!catalogs.has(locale)) catalogs.set(locale, new Map())
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      console.error(`ERROR  ${file}: invalid JSON (${err.message})`)
      process.exitCode = 1
      continue
    }
    catalogs.get(locale).set(namespace, {
      file,
      flat: flatten(parsed),
    })
  }

  if (!catalogs.has(args.base)) {
    console.error(`Base locale "${args.base}" not found. Available: ${[...catalogs.keys()].join(', ')}`)
    process.exit(2)
  }

  const base = catalogs.get(args.base)
  const errors = []
  const warnings = []
  const results = []
  const push = (list, entry) => {
    list.push(entry)
    results.push(entry)
  }

  for (const [locale, namespaces] of catalogs) {
    if (locale === args.base) continue

    for (const [ns, baseEntry] of base) {
      const targetEntry = namespaces.get(ns)

      if (!targetEntry) {
        push(errors, {
          level: 'error',
          locale,
          namespace: ns,
          type: 'missing-namespace',
          message: `missing namespace "${ns}" (${Object.keys(baseEntry.flat).length} keys)`,
        })
        continue
      }

      for (const key of Object.keys(baseEntry.flat)) {
        if (!(key in targetEntry.flat)) {
          push(errors, {
            level: 'error',
            locale,
            namespace: ns,
            key,
            type: 'missing-key',
            message: 'missing key',
          })
        }
      }

      for (const key of Object.keys(targetEntry.flat)) {
        if (!(key in baseEntry.flat)) {
          push(warnings, {
            level: 'warning',
            locale,
            namespace: ns,
            key,
            type: 'extra-key',
            message: 'key does not exist in the base locale',
          })
        }
      }

      for (const [key, value] of Object.entries(targetEntry.flat)) {
        if (typeof value !== 'string') continue
        for (const issue of validateMessage(value)) {
          push(errors, {
            level: 'error',
            locale,
            namespace: ns,
            key,
            type: 'invalid-message',
            message: issue,
          })
        }
        if (key in baseEntry.flat && typeof baseEntry.flat[key] === 'string') {
          const expected = collectArgs(baseEntry.flat[key])
          const actual = collectArgs(value)
          const missing = [...expected].filter((arg) => !actual.has(arg))
          if (missing.length) {
            push(errors, {
              level: 'error',
              locale,
              namespace: ns,
              key,
              type: 'missing-placeholder',
              message: `missing placeholder(s): ${missing.join(', ')}`,
            })
          }
          const extra = [...actual].filter((arg) => !expected.has(arg))
          if (extra.length) {
            push(warnings, {
              level: 'warning',
              locale,
              namespace: ns,
              key,
              type: 'extra-placeholder',
              message: `placeholder(s) not present in base: ${extra.join(', ')}`,
            })
          }
        }
      }

      // Base syntax is validated too: a broken base breaks every locale.
    }

    for (const ns of namespaces.keys()) {
      if (!base.has(ns)) {
        push(warnings, {
          level: 'warning',
          locale,
          namespace: ns,
          type: 'unknown-namespace',
          message: 'namespace does not exist in the base locale',
        })
      }
    }
  }

  for (const [ns, entry] of base) {
    for (const [key, value] of Object.entries(entry.flat)) {
      if (typeof value !== 'string') continue
      for (const issue of validateMessage(value)) {
        push(errors, {
          level: 'error',
          locale: args.base,
          namespace: ns,
          key,
          type: 'invalid-base-message',
          message: issue,
        })
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ root, base: args.base, errors, warnings }, null, 2))
  } else {
    const print = (entry) => {
      const where = `${entry.locale}/${entry.namespace}${entry.key ? `#${entry.key}` : ''}`
      console.log(`${entry.level === 'error' ? 'ERROR' : 'WARN '}  ${where}  ${entry.message}`)
    }
    for (const entry of errors) print(entry)
    for (const entry of warnings) print(entry)

    const locales = [...catalogs.keys()].sort()
    console.log('')
    console.log(`Catalogs: ${files.length} files, ${locales.length} locale(s) [${locales.join(', ')}]`)
    console.log(`Base: ${args.base}`)
    console.log(`Result: ${errors.length} error(s), ${warnings.length} warning(s)`)
  }

  if (errors.length > 0 || (args.strict && warnings.length > 0)) process.exitCode = 1
}

main()
