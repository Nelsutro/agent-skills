#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.vue', '.svelte', '.astro'])
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', 'vendor',
])
const TEST_FILE = /(?:^|[\\/])(?:__tests__|__mocks__)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$/
const SENSITIVE_HIDDEN = /(?:tenant|org|workspace|account|user|owner|role|permission|admin|price|amount|total|status|plan|credit|balance)/i
const AUTOCOMPLETE_NAME = /(?:^|_)(?:email|name|first|last|middle|phone|tel|address|street|city|state|region|postal|zip|country|password|username|cc|card|coupon|code)(?:_|$)/i
const ERROR_RENDER = /dangerouslySetInnerHTML|\binnerHTML\s*=|\baria-invalid\b|\{[^}\n]*\b(?:errors?|errorMessage)\b[^}\n]*(?:&&|\?(?!:)|\.|\[|\))/
const PENDING_HINT = /\b(?:pending|isPending|isSubmitting|submitting|useFormStatus|useActionState|useNavigation|isLoading)\b/
const INTERACTIVE = /['"]use client['"]|\bonSubmit\b|\buseActionState\b|\buseFormStatus\b|\buseNavigation\b|\buseFetcher\b|\baction\s*=\s*\{/

function parseArgs(argv) {
  const args = {
    paths: [],
    json: false,
    failOn: false,
    includeTests: false,
    ignore: new Set(),
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--fail-on' || a === '--fail-on-match') args.failOn = true
    else if (a === '--include-tests') args.includeTests = true
    else if (a === '--ignore' || a === '--allow') {
      for (const rule of String(argv[++i] ?? '').split(',')) {
        if (rule.trim()) args.ignore.add(rule.trim())
      }
    } else if (a === '-h' || a === '--help') args.help = true
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
    if (EXT.has(extname(target).toLowerCase())) out.push(target)
    return out
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(target, entry.name), args, out)
    } else if (entry.isFile()) {
      if (!EXT.has(extname(entry.name).toLowerCase())) continue
      const full = join(target, entry.name)
      if (!args.includeTests && TEST_FILE.test(full)) continue
      out.push(full)
    }
  }
  return out
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
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
    if (ch === '{') {
      brace++
      continue
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1)
      continue
    }
    if (ch === '>' && brace === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

function tags(source) {
  const out = []
  const re = /<(input|form|button|label|select|textarea|Field)\b/gi
  let match
  while ((match = re.exec(source))) {
    out.push({ name: match[1].toLowerCase(), start: match.index, text: readTag(source, match.index) })
  }
  return out
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([\\s\\S]*?)\\})`, 'i')
  const match = tag.match(re)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? ''
}

function hasAttr(tag, name) {
  return new RegExp(`\\b${name}\\b`, 'i').test(tag)
}

function wrappedInLabel(source, index) {
  const open = source.lastIndexOf('<label', index)
  if (open < 0) return false
  const closedBefore = source.lastIndexOf('</label', index)
  if (closedBefore > open) return false
  const closeAfter = source.indexOf('</label', index)
  return closeAfter > index
}

function scanFile(file, root, args) {
  const source = readFileSync(file, 'utf8')
  const rel = relative(root, file).replaceAll('\\', '/')
  const findings = []
  const all = tags(source)
  const labelIds = new Set()
  const fileIsForm = /<(?:input|form|Field|select|textarea)\b/i.test(source)

  for (const tag of all) {
    if (tag.name !== 'label') continue
    const id = attr(tag.text, 'htmlFor') ?? attr(tag.text, 'for')
    if (id) labelIds.add(id)
  }

  function report(rule, index, message, tag) {
    const line = lineOf(source, index)
    const lineText = source.split(/\r?\n/)[line - 1] ?? ''
    if (lineText.includes('form-ok')) return
    if (source.slice(Math.max(0, index - 120), index).includes('form-ok')) return
    if (args.ignore.has(rule)) return
    findings.push({ file: rel, line, rule, severity: 'error', message, tag: tag?.slice(0, 160) })
  }

  const hasAlert = /role\s*=\s*["'{]?\s*alert|aria-live\s*=|aria-describedby\s*=/.test(source)
  const hasErrorRender = ERROR_RENDER.test(source)

  if (fileIsForm && hasErrorRender && !hasAlert) {
    const index = source.search(ERROR_RENDER)
    report('error-not-announced', Math.max(0, index), 'Error text is rendered without role="alert", aria-live, or aria-describedby')
  }

  if (fileIsForm && /\bpreventDefault\s*\(/.test(source) && !/\b(?:fetch|axios|useActionState|useFetcher|useSubmit|mutation|action)\s*\(/.test(source)) {
    for (const tag of all) {
      if (tag.name !== 'form') continue
      if (hasAttr(tag.text, 'onSubmit') && !hasAttr(tag.text, 'action')) {
        report('client-only-form', tag.start, 'Form handles submit on the client without an action, fetch, or mutation')
        break
      }
    }
  }

  if (fileIsForm && INTERACTIVE.test(source) && !PENDING_HINT.test(source)) {
    for (const tag of all) {
      if (tag.name !== 'button') continue
      const type = (attr(tag.text, 'type') ?? 'submit').toLowerCase()
      if (type !== 'submit') continue
      if (hasAttr(tag.text, 'disabled') || hasAttr(tag.text, 'aria-busy') || hasAttr(tag.text, 'data-pending')) continue
      report('submit-no-pending', tag.start, 'Submit button has no disabled or aria-busy state')
      break
    }
  }

  if (/\bdangerouslySetInnerHTML\b|\binnerHTML\s*=/.test(source)) {
    const index = source.search(/\bdangerouslySetInnerHTML\b|\binnerHTML\s*=/)
    const lineText = source.split(/\r?\n/)[lineOf(source, index) - 1] ?? ''
    const near = source.slice(index, index + 240)
    if (/error|message/i.test(lineText) || /error|message/i.test(near)) {
      report('unsafe-error-html', index, 'Error text is inserted as HTML; render it as text instead')
    }
  }

  for (const tag of all) {
    if (tag.name !== 'input') continue
    const type = (attr(tag.text, 'type') ?? 'text').toLowerCase()
    const name = attr(tag.text, 'name')
    const isButton = ['submit', 'button', 'reset', 'image'].includes(type)
    const isHidden = type === 'hidden'

    if (isHidden && name && SENSITIVE_HIDDEN.test(name) && !/idempotency/i.test(name)) {
      report('hidden-sensitive-input', tag.start, `Hidden input "${name}" carries a value the server must derive`, tag.text)
    }

    if (isButton) continue

    if (!isHidden && (!name || !name.trim())) {
      report('input-missing-name', tag.start, 'Input has no name and will not be submitted', tag.text)
    }

    if (!isHidden && !hasAttr(tag.text, 'aria-label') && !hasAttr(tag.text, 'aria-labelledby')) {
      const id = attr(tag.text, 'id')
      const labelled = (id && labelIds.has(id)) || wrappedInLabel(source, tag.start)
      if (!labelled) {
        report('input-missing-label', tag.start, `Input${name ? ` "${name}"` : ''} has no associated label`, tag.text)
      }
    }

    const noAutocompleteType = ['file', 'checkbox', 'radio', 'range', 'color', 'date', 'time', 'datetime-local', 'month', 'week'].includes(type)
    if (!isHidden && !noAutocompleteType && !hasAttr(tag.text, 'autoComplete') && !hasAttr(tag.text, 'autocomplete')) {
      const needsAutocomplete =
        ['email', 'tel', 'password'].includes(type) ||
        (name && AUTOCOMPLETE_NAME.test(name) && !/coupon|code|quantity|search/i.test(name))
      if (needsAutocomplete) {
        report('input-missing-autocomplete', tag.start, `Input${name ? ` "${name}"` : ''} has no autocomplete token`, tag.text)
      }
    }

    if (type === 'file') {
      if (!hasAttr(tag.text, 'accept')) {
        report('file-input-missing-accept', tag.start, 'File input has no accept allowlist', tag.text)
      }
      if (!/\bmaxSize\b|\bMAX_FILE|\bMAX_BYTES|\bmax_size\b|file\.size|\bsize\s*[<>]|\b5\s*\*\s*1024\b/i.test(source)) {
        report('file-input-missing-size-limit', tag.start, 'File input has no server-enforced size limit', tag.text)
      }
    }
  }

  if (/['"]use server['"]/.test(source) && /\bformData\b/.test(source) && !/\b(?:safeParse|parse)\s*\(|\bSchema\b/.test(source)) {
    const index = source.search(/\bformData\b/)
    report('server-action-no-parse', index, 'Server action reads FormData without parsing a schema')
  }

  return findings
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/scan-forms.mjs [paths...] [--json] [--fail-on] [--include-tests] [--ignore rule,...]')
    process.exit(0)
  }

  const root = resolve('.')
  const files = []
  for (const target of args.paths) {
    for (const file of walk(resolve(target), args)) {
      if (!files.includes(file)) files.push(file)
    }
  }

  const findings = files.flatMap((file) => scanFile(file, root, args))
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule))

  if (args.json) {
    const byRule = {}
    for (const finding of findings) byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1
    console.log(JSON.stringify({ findings, summary: { files: files.length, findings: findings.length, byRule } }, null, 2))
  } else {
    let current = null
    for (const finding of findings) {
      if (finding.file !== current) {
        current = finding.file
        console.log(`\n${current}`)
      }
      console.log(`  ${finding.line}  ${finding.rule}  ${finding.message}`)
    }
    const count = findings.length
    console.log(`\n${count} finding(s) in ${files.length} file(s)`)
  }

  if (args.failOn && findings.length > 0) process.exit(1)
}

main()
