#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out', 'coverage'])
const DEFAULT_ALLOW = new Set([
  '_csrf', 'csrfToken', 'csrf_token', 'idempotencyKey', 'idempotency_key',
  'redirectTo', 'returnTo', 'next', '_method',
])

function parseArgs(argv) {
  const args = { schema: null, form: null, json: false, failOn: false, allow: new Set(DEFAULT_ALLOW), help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--schema') args.schema = argv[++i]
    else if (a === '--form') args.form = argv[++i]
    else if (a === '--json') args.json = true
    else if (a === '--fail-on') args.failOn = true
    else if (a === '--allow') {
      for (const field of String(argv[++i] ?? '').split(',')) {
        if (field.trim()) args.allow.add(field.trim())
      }
    } else if (a === '-h' || a === '--help') args.help = true
  }
  return args
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function displayPath(file) {
  const rel = relative(process.cwd(), file).replaceAll('\\', '/')
  return rel.startsWith('..') ? file.replaceAll('\\', '/') : rel
}

function stripComments(source) {
  let out = ''
  let quote = null
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote) {
      out += ch
      if (ch === quote && source[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' '
        i++
      }
      if (i < source.length) out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < source.length) {
        out += '  '
        i++
      }
      continue
    }
    out += ch
  }
  return out
}

function matchingBrace(source, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function schemaKeys(source) {
  const clean = stripComments(source)
  const match = /\b(?:[A-Za-z_$][\w$]*\.)?object\s*\(\s*\{/.exec(clean)
  if (!match) return []
  const open = clean.indexOf('{', match.index)
  const close = matchingBrace(clean, open)
  if (close < 0) return []

  const body = clean.slice(open + 1, close)
  const keys = []
  let i = 0
  let brace = 0
  let bracket = 0
  let paren = 0
  let quote = null

  while (i < body.length) {
    const ch = body[i]
    if (quote) {
      if (ch === quote && body[i - 1] !== '\\') quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      i++
      continue
    }
    if (ch === '{') brace++
    else if (ch === '}') brace--
    else if (ch === '[') bracket++
    else if (ch === ']') bracket--
    else if (ch === '(') paren++
    else if (ch === ')') paren--

    const top = brace === 0 && bracket === 0 && paren === 0
    const startOfKey = top && (i === 0 || body[i - 1] === ',' || body[i - 1] === '\n')
    if (startOfKey) {
      let j = i
      while (j < body.length && /\s/.test(body[j])) j++
      let key = null
      let keyStart = j
      if (body[j] === '"' || body[j] === "'") {
        const q = body[j]
        keyStart = j + 1
        j++
        while (j < body.length && !(body[j] === q && body[j - 1] !== '\\')) j++
        key = body.slice(keyStart, j)
        j++
      } else if (/[A-Za-z_$]/.test(body[j] ?? '')) {
        keyStart = j
        while (j < body.length && /[\w$]/.test(body[j])) j++
        key = body.slice(keyStart, j)
      }
      if (key) {
        while (j < body.length && /\s/.test(body[j])) j++
        if (body[j] === ':' && brace === 0 && bracket === 0 && paren === 0) {
          const valueStart = j + 1
          let k = valueStart
          let b = 0
          let s = 0
          let p = 0
          let q = null
          while (k < body.length) {
            const c = body[k]
            if (q) {
              if (c === q && body[k - 1] !== '\\') q = null
              k++
              continue
            }
            if (c === '"' || c === "'" || c === '`') q = c
            else if (c === '{') b++
            else if (c === '}') b--
            else if (c === '[') s++
            else if (c === ']') s--
            else if (c === '(') p++
            else if (c === ')') p--
            else if (c === ',' && b === 0 && s === 0 && p === 0) break
            k++
          }
          const value = body.slice(valueStart, k)
          keys.push({
            key,
            line: lineOf(clean, open + 1 + keyStart),
            optional: /\.(?:optional|nullish|default)\s*\(/.test(value),
          })
          i = k
          continue
        }
      }
    }
    i++
  }
  return keys
}

function readTag(source, start) {
  let quote = null
  let brace = 0
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') brace++
    else if (ch === '}') brace = Math.max(0, brace - 1)
    else if (ch === '>' && brace === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([\\s\\S]*?)\\})`, 'i')
  const match = tag.match(re)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

function hasAttr(tag, name) {
  return new RegExp(`\\b${name}\\b`, 'i').test(tag)
}

function normalizeField(name) {
  return name.replace(/\[[^\]]*\]/g, '').replace(/\.\d+(?=\.|$)/g, '').split('.')[0]
}

function formFields(source) {
  const clean = stripComments(source)
  const fields = new Map()
  const re = /<(input|select|textarea|Field)\b/gi
  let match
  while ((match = re.exec(clean))) {
    const tag = readTag(clean, match.index)
    const name = attr(tag, 'name')
    if (!name || !/^[A-Za-z_$][\w$.[\]-]*$/.test(name)) continue
    const field = normalizeField(name)
    fields.set(field, {
      field,
      line: lineOf(clean, match.index),
      required: hasAttr(tag, 'required') || /aria-required\s*=\s*["'{]?true/i.test(tag),
      optional: /aria-required\s*=\s*["'{]?false/i.test(tag) || hasAttr(tag, 'optional'),
    })
  }
  const register = /\bregister\s*\(\s*['"]([^'"]+)['"]/g
  while ((match = register.exec(clean))) {
    const field = normalizeField(match[1])
    if (!fields.has(field)) {
      fields.set(field, { field, line: lineOf(clean, match.index), required: false, optional: false })
    }
  }
  return fields
}

function collectFiles(target) {
  const root = resolve(target)
  let stat
  try {
    stat = statSync(root)
  } catch {
    return { root, files: [] }
  }
  if (stat.isFile()) return { root, files: [root] }
  const files = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
      } else if (entry.isFile() && EXT.has(extname(entry.name).toLowerCase())) {
        files.push(join(dir, entry.name))
      }
    }
  }
  walk(root)
  return { root, files }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/check-form-schema.mjs --schema <file> --form <file|dir> [--json] [--fail-on] [--allow field,...]')
    process.exit(0)
  }
  if (!args.schema || !args.form) {
    console.error('Both --schema and --form are required. Use --help for usage.')
    process.exit(2)
  }

  const schemaSource = readFileSync(resolve(args.schema), 'utf8')
  const schema = schemaKeys(schemaSource)
  if (schema.length === 0) {
    console.error(`No object schema keys found in ${args.schema}`)
    process.exit(2)
  }

  const formTarget = collectFiles(args.form)
  const forms = new Map()
  for (const file of formTarget.files) {
    const source = readFileSync(file, 'utf8')
    for (const [field, meta] of formFields(source)) {
      if (!forms.has(field)) forms.set(field, { ...meta, file })
    }
  }

  const issues = []
  const schemaMap = new Map(schema.map((entry) => [entry.key, entry]))
  for (const entry of schema) {
    if (args.allow.has(entry.key) || forms.has(entry.key)) continue
    issues.push({
      file: displayPath(resolve(args.schema)),
      line: entry.line,
      rule: 'missing-in-form',
      field: entry.key,
      message: `Schema field "${entry.key}" is not rendered in the form`,
    })
  }
  for (const [field, meta] of forms) {
    if (args.allow.has(field)) continue
    const entry = schemaMap.get(field)
    if (!entry) {
      issues.push({
        file: displayPath(meta.file),
        line: meta.line,
        rule: 'missing-in-schema',
        field,
        message: `Form field "${field}" is not in the schema`,
      })
      continue
    }
    if (entry.optional && meta.required) {
      issues.push({
        file: displayPath(meta.file),
        line: meta.line,
        rule: 'required-mismatch',
        field,
        message: `Field "${field}" is optional in the schema but required in the form`,
      })
    }
    if (!entry.optional && meta.optional) {
      issues.push({
        file: displayPath(meta.file),
        line: meta.line,
        rule: 'required-mismatch',
        field,
        message: `Field "${field}" is required in the schema but marked optional in the form`,
      })
    }
  }

  issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule))

  if (args.json) {
    console.log(JSON.stringify({
      schema: { file: args.schema, fields: [...schemaMap.keys()] },
      form: { files: formTarget.files.length, fields: [...forms.keys()] },
      issues,
      summary: { issues: issues.length },
    }, null, 2))
  } else {
    console.log(`Schema: ${args.schema} (${schema.length} field(s))`)
    console.log(`Form: ${formTarget.files.length} file(s), ${forms.size} field(s)`)
    for (const issue of issues) {
      console.log(`  ${issue.file}:${issue.line}  ${issue.rule}  ${issue.message}`)
    }
    console.log(`\n${issues.length} issue(s)`)
  }

  if (args.failOn && issues.length > 0) process.exit(1)
}

main()
