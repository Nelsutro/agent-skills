#!/usr/bin/env node
/**
 * Generate a pseudo-localized copy of a JSON catalog.
 *
 * Usage:
 *   node scripts/pseudo-localize.mjs messages/en.json --out messages/en-XA.json
 *   node scripts/pseudo-localize.mjs messages/en --out messages/en-XA --expansion 1.4
 *
 * - Accents ASCII letters so untranslated strings stand out.
 * - Expands each word to simulate translation growth (default 35%).
 * - Wraps values in guillemets to expose truncation.
 * - Preserves ICU arguments, plural/select syntax, #, and rich-text tags.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

const MAP = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ',
  k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ',
  u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
}
const UPPER = Object.fromEntries(
  Object.entries(MAP).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
)
const FILLER = 'áéíóúñç'
const OPEN = '⟦'
const CLOSE = '⟧'

function parseArgs(argv) {
  const args = { input: null, out: null, expansion: 1.35 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out' || a === '-o') args.out = argv[++i]
    else if (a === '--expansion' || a === '-e') args.expansion = Number(argv[++i])
    else if (a === '-h' || a === '--help') args.help = true
    else if (!a.startsWith('-') && !args.input) args.input = a
  }
  if (!Number.isFinite(args.expansion) || args.expansion < 1) args.expansion = 1.35
  return args
}

function matchBrace(text, start) {
  let depth = 0
  let quote = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === "'") quote = false
      continue
    }
    if (ch === "'" && (text[i + 1] === '{' || text[i + 1] === '}' || text[i + 1] === '#')) {
      quote = true
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

function accent(text) {
  let out = ''
  for (const ch of text) {
    out += MAP[ch] ?? UPPER[ch] ?? ch
  }
  return out
}

function expandWord(word, factor) {
  if (word.length === 0) return word
  const extra = Math.max(0, Math.ceil(word.length * (factor - 1)))
  if (extra === 0) return word
  let filler = ''
  for (let i = 0; i < extra; i++) filler += FILLER[i % FILLER.length]
  return word + filler
}

function transformLiteral(text, factor) {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (part === '' || /^\s+$/.test(part)) return part
      const match = part.match(/^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u)
      if (!match) return part
      const [, prefix, core, suffix] = match
      return prefix + expandWord(accent(core), factor) + suffix
    })
    .join('')
}

function transformBranches(rest, factor) {
  let out = ''
  let i = 0
  while (i < rest.length) {
    const open = rest.indexOf('{', i)
    if (open === -1) {
      out += rest.slice(i)
      break
    }
    out += rest.slice(i, open)
    const end = matchBrace(rest, open)
    if (end === -1) {
      out += rest.slice(open)
      break
    }
    out += `{${transformMessage(rest.slice(open + 1, end), factor)}}`
    i = end + 1
  }
  return out
}

function transformGroup(inner, factor) {
  const match = inner.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([a-z]+)\s*(?:,\s*([\s\S]*))?)?$/)
  if (!match) return `{${inner}}`
  const [, name, type, rest] = match
  if (type === 'plural' || type === 'selectordinal' || type === 'select') {
    return `{${name}, ${type}, ${transformBranches(rest ?? '', factor)}}`
  }
  if (type === 'number' || type === 'date' || type === 'time') return `{${inner}}`
  return `{${inner}}`
}

function transformMessage(message, factor) {
  let out = ''
  let literal = ''
  const flush = () => {
    if (literal) {
      out += transformLiteral(literal, factor)
      literal = ''
    }
  }

  for (let i = 0; i < message.length; i++) {
    const ch = message[i]

    if (ch === "'" ) {
      if (message[i + 1] === "'") {
        literal += "''"
        i++
        continue
      }
      literal += ch
      continue
    }

    if (ch === '{') {
      const end = matchBrace(message, i)
      if (end === -1) {
        literal += ch
        continue
      }
      flush()
      out += transformGroup(message.slice(i + 1, end), factor)
      i = end
      continue
    }

    if (ch === '<') {
      const close = message.indexOf('>', i)
      if (close !== -1) {
        const tag = message.slice(i, close + 1)
        if (/^<\/?[A-Za-z][^<>]*>$/.test(tag)) {
          flush()
          out += tag
          i = close
          continue
        }
      }
    }

    literal += ch
  }
  flush()
  return out
}

function pseudoValue(value, factor) {
  if (typeof value !== 'string') return value
  if (value.trim() === '') return value
  if (/^\s*(?:https?:)?\/\//i.test(value)) return value
  return OPEN + transformMessage(value, factor) + CLOSE
}

function transformJson(value, factor) {
  if (typeof value === 'string') return pseudoValue(value, factor)
  if (Array.isArray(value)) return value.map((item) => transformJson(item, factor))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) out[key] = transformJson(val, factor)
    return out
  }
  return value
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') out.push(full)
  }
  return out
}

function writeJson(target, data) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.input) {
    console.log('Usage: node scripts/pseudo-localize.mjs <catalog.json|dir> [--out <file|dir>] [--expansion 1.35]')
    process.exit(args.help ? 0 : 2)
  }

  const input = resolve(args.input)
  let stat
  try {
    stat = statSync(input)
  } catch {
    console.error(`Not found: ${input}`)
    process.exit(2)
  }

  if (stat.isFile()) {
    const out = resolve(args.out || input.replace(/\.json$/i, '.pseudo.json'))
    const data = JSON.parse(readFileSync(input, 'utf8'))
    writeJson(out, transformJson(data, args.expansion))
    console.log(`Pseudo-localized ${basename(input)} -> ${relative(process.cwd(), out)}`)
    return
  }

  if (!stat.isDirectory()) {
    console.error(`Unsupported input: ${input}`)
    process.exit(2)
  }

  const outDir = resolve(args.out || `${input}-XA`)
  const files = walk(input)
  if (files.length === 0) {
    console.error(`No JSON catalogs found in ${input}`)
    process.exit(2)
  }

  for (const file of files) {
    const rel = relative(input, file)
    const target = join(outDir, rel)
    const data = JSON.parse(readFileSync(file, 'utf8'))
    writeJson(target, transformJson(data, args.expansion))
  }

  console.log(`Pseudo-localized ${files.length} file(s) from ${basename(input)} -> ${relative(process.cwd(), outDir)}`)
}

main()
