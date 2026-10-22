#!/usr/bin/env node
/**
 * End-to-end check for the web-i18n skill.
 *
 * Run from the repository root:
 *   node examples/test.mjs
 *   npm test
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const scripts = join(repo, 'web-i18n', 'scripts')

let failures = 0
let checks = 0

function run(script, args, options = {}) {
  const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
    cwd: here,
    encoding: 'utf8',
    ...options,
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`PASS  ${name}`)
  } else {
    failures++
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

function flatten(value, prefix = '', out = {}) {
  for (const [key, val] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (val && typeof val === 'object' && !Array.isArray(val)) flatten(val, full, out)
    else out[full] = val
  }
  return out
}

console.log('\nweb-i18n | end-to-end check\n')

// 1. The scanner finds hardcoded strings in the "before" component.
const scanBefore = run('scan-hardcoded.mjs', ['before', '--json'])
let before = { findings: [] }
try {
  before = JSON.parse(scanBefore.output)
} catch {
  // handled by the assertion below
}
const beforeTexts = before.findings.map((f) => f.text)
check('scanner flags the untranslated component', before.findings.length >= 6, `found ${before.findings.length}`)
check('scanner finds a text node', beforeTexts.includes('Continue to checkout'))
check('scanner finds a translated attribute', beforeTexts.includes('Coupon code'))

// 2. After applying the skill's guidance, nothing is hardcoded.
const scanAfter = run('scan-hardcoded.mjs', ['after', '--json'])
let after = { findings: [] }
try {
  after = JSON.parse(scanAfter.output)
} catch {
  // handled by the assertion below
}
check('scanner reports zero candidates after i18n', after.findings.length === 0, `found ${after.findings.length}`)

// 3. The validator rejects the seeded broken catalogs.
const broken = run('check-locales.mjs', ['broken', '--base', 'en'])
check('validator exits 1 on broken catalogs', broken.status === 1, `exit ${broken.status}`)
check('validator reports a missing key', broken.output.includes('missing key'))
check('validator reports a missing plural branch', broken.output.includes('missing an "other" branch'))
check('validator reports an empty value', broken.output.includes('empty value'))
check('validator reports an unbalanced brace', broken.output.includes('unbalanced "{"'))
check('validator reports a placeholder mismatch', broken.output.includes('missing placeholder(s): name'))

// 4. The validator accepts the corrected catalogs.
const fixed = run('check-locales.mjs', ['fixed', '--base', 'en'])
check('validator exits 0 on valid catalogs', fixed.status === 0, `exit ${fixed.status}`)
check('validator reports no errors or warnings', fixed.output.includes('0 error(s), 0 warning(s)'))
check('validator is aware of plural categories', fixed.output.includes('4 locale(s)'))

// 5. Pseudo-localization expands copy while preserving ICU syntax.
const tmp = mkdtempSync(join(tmpdir(), 'web-i18n-'))
try {
  const out = join(tmp, 'en-XA.json')
  const pseudoRun = run('pseudo-localize.mjs', [join('fixed', 'en.json'), '--out', out])
  check('pseudo-localizer runs', pseudoRun.status === 0, `exit ${pseudoRun.status}`)

  const source = flatten(JSON.parse(readFileSync(join(here, 'fixed', 'en.json'), 'utf8')))
  const pseudo = flatten(JSON.parse(readFileSync(out, 'utf8')))

  check('pseudo-localizer keeps every key', Object.keys(pseudo).length === Object.keys(source).length)
  check('pseudo-localizer wraps every value', Object.values(pseudo).every((v) => v.startsWith('⟦') && v.endsWith('⟧')))
  check('pseudo-localizer preserves {name}', pseudo['inbox.greeting'].includes('{name}'))
  check(
    'pseudo-localizer preserves ICU plural syntax',
    pseudo['inbox.unread'].includes('{count, plural,') && pseudo['inbox.unread'].includes('other {'),
  )
  check(
    'pseudo-localizer preserves rich-text tags',
    pseudo['checkout.terms'].includes('<link>') && pseudo['checkout.terms'].includes('</link>'),
  )
  check(
    'pseudo-localizer expands the visible copy',
    pseudo['inbox.greeting'].length > source['inbox.greeting'].length,
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed.\n`)
if (failures > 0) process.exit(1)
