#!/usr/bin/env node
/**
 * Heuristically find hardcoded user-facing strings.
 *
 * Usage:
 *   node scripts/scan-hardcoded.mjs [paths...] [--ext .ts,.tsx] [--json]
 *                                  [--include-tests] [--fail-on-match]
 *
 * This is an audit aid, not a proof. Review candidates before changing code:
 * some matches are constants, URLs, test fixtures, or developer-only text.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const DEFAULT_EXT = [
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.html', '.htm',
]
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', 'vendor', 'locales', 'messages', 'i18n',
])
const TEST_FILE = /(?:^|[\\/])(?:__tests__|__mocks__)[\\/]|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/

function parseArgs(argv) {
  const args = {
    paths: [],
    ext: null,
    json: false,
    includeTests: false,
    failOnMatch: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ext') args.ext = argv[++i].split(',').map((e) => (e.startsWith('.') ? e : `.${e}`))
    else if (a === '--json') args.json = true
    else if (a === '--include-tests') args.includeTests = true
    else if (a === '--fail-on-match') args.failOnMatch = true
    else if (a === '-h' || a === '--help') args.help = true
    else if (!a.startsWith('-')) args.paths.push(a)
  }
  if (args.paths.length === 0) args.paths.push('.')
  if (!args.ext) args.ext = DEFAULT_EXT
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
    if (args.ext.includes(extname(target).toLowerCase())) out.push(target)
    return out
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(target, entry.name), args, out)
    } else if (entry.isFile()) {
      if (!args.ext.includes(extname(entry.name).toLowerCase())) continue
      if (!args.includeTests && TEST_FILE.test(join(target, entry.name))) continue
      out.push(join(target, entry.name))
    }
  }
  return out
}

const ATTRIBUTE = /\b(placeholder|title|aria-label|aria-description|alt|label|description|summary|message|errorMessage|helperText|emptyText|tooltip|confirmText|cancelText)\s*=\s*(?:"([^"]{3,})"|'([^']{3,})'|\{`([^`]{3,})`\})/g
const JSX_TEXT = />\s*([A-Za-zÀ-ÖØ-öø-ÿ0-9¿¡][^<>{}\n]{2,}?)\s*</g
const ALERT = /\b(?:alert|confirm|prompt)\s*\(\s*(?:"([^"]{3,})"|'([^']{3,})'|`([^`]{3,})`)/g
const ERROR = /\bthrow\s+new\s+\w*Error\s*\(\s*(?:"([^"]{3,})"|'([^']{3,})'|`([^`]{3,})`)/g

const FALSE_POSITIVE = [
  /^(?:https?:)?\/\//i,
  /^\//,
  /^#/,
  /^[\w-]+$/i,
  /^[\d\s.,:;%+\-]+$/,
  /^[a-z0-9-]+(?::[a-z0-9-]+)+$/i,
  /^var\(--/,
  /^[A-Z_]+$/,
  /^\.[\w-]+$/,
  /^[a-z]+[A-Z]\w*$/,
  /^[\w.-]+\.[a-z]{2,}(?:[\\/][\w.-]*)*$/i,
  /^\s*$/,
]

function looksLikeCopy(text) {
  const value = text.trim()
  if (value.length < 3) return false
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ\u0590-\u08FF\u4E00-\u9FFF]/.test(value)) return false
  if (FALSE_POSITIVE.some((re) => re.test(value))) return false
  if (/[{}<>]|=>|&&|\|\||\$\{/.test(value)) return false
  if (/^\s*(?:className|style|key|id|href|src|type|name|role|data-[\w-]+)\s*=/.test(value)) return false
  if (/\b(?:console\.|import\s|require\(|export\s|function\s|return\s|const\s|let\s)/.test(value)) return false
  return true
}

function scanFile(file, root) {
  const findings = []
  let content
  try {
    const stat = statSync(file)
    if (stat.size > 2_000_000) return findings
    content = readFileSync(file, 'utf8')
  } catch {
    return findings
  }

  const lines = content.split(/\r?\n/)
  const rules = [
    { name: 'attribute', re: ATTRIBUTE, groups: [2, 3, 4] },
    { name: 'jsx-text', re: JSX_TEXT, groups: [1] },
    { name: 'dialog', re: ALERT, groups: [1, 2, 3] },
    { name: 'error', re: ERROR, groups: [1, 2, 3] },
  ]

  lines.forEach((line, index) => {
    for (const rule of rules) {
      rule.re.lastIndex = 0
      let match
      while ((match = rule.re.exec(line)) !== null) {
        const text = rule.groups.map((g) => match[g]).find((v) => v !== undefined)
        if (!text || !looksLikeCopy(text)) continue
        findings.push({
          file: relative(root, file) || file,
          line: index + 1,
          column: match.index + 1,
          rule: rule.name,
          text: text.trim().replace(/\s+/g, ' ').slice(0, 160),
        })
      }
    }
  })

  return findings
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/scan-hardcoded.mjs [paths...] [--ext .ts,.tsx] [--json] [--include-tests] [--fail-on-match]')
    process.exit(0)
  }

  const cwd = process.cwd()
  const files = []
  for (const target of args.paths) {
    for (const file of walk(resolve(target), args)) {
      if (!files.includes(file)) files.push(file)
    }
  }

  const findings = files.flatMap((file) => scanFile(file, cwd))
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
        console.log(`  ${item.line}:${item.column}  [${item.rule}]  ${item.text}`)
      }
    }
    console.log('')
    console.log(`Scanned ${files.length} file(s); found ${findings.length} candidate(s) in ${byFile.size} file(s).`)
    if (findings.length > 0) {
      console.log('Candidates still need review: constants, URLs, and test data are expected false positives.')
    }
  }

  if (args.failOnMatch && findings.length > 0) process.exitCode = 1
}

main()
