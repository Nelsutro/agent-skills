#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const scripts = join(repo, 'web-forms', 'scripts')

let failures = 0
let checks = 0

function run(script, args) {
  const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
    cwd: here,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

function json(result) {
  try {
    return JSON.parse(result.output)
  } catch {
    return null
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

function ruleSet(scan) {
  return new Set((scan?.findings ?? []).map((finding) => finding.rule))
}

console.log('\nweb-forms | end-to-end check\n')

const beforeRun = run('scan-forms.mjs', ['before', '--json'])
const before = json(beforeRun)
check('scanner parses the before fixture', before !== null, beforeRun.output.slice(0, 400))
check('scanner finds at least ten problems', (before?.findings ?? []).length >= 10, `found ${before?.findings?.length}`)

const beforeRules = ruleSet(before)
for (const rule of [
  'input-missing-name',
  'input-missing-label',
  'input-missing-autocomplete',
  'client-only-form',
  'error-not-announced',
  'submit-no-pending',
  'hidden-sensitive-input',
  'file-input-missing-accept',
  'file-input-missing-size-limit',
  'unsafe-error-html',
  'server-action-no-parse',
]) {
  check(`scanner reports ${rule}`, beforeRules.has(rule), [...beforeRules].join(', '))
}

check('scanner reports a JSON summary', (before?.summary?.byRule?.['input-missing-label'] ?? 0) >= 1)

const afterRun = run('scan-forms.mjs', ['after', '--json'])
const after = json(afterRun)
check('scanner parses the after fixture', after !== null, afterRun.output.slice(0, 400))
check('scanner reports zero problems after the fix', (after?.findings ?? []).length === 0, JSON.stringify(after?.findings))

check('scanner exits 1 with --fail-on before the fix', run('scan-forms.mjs', ['before', '--fail-on']).status === 1)
check('scanner exits 0 with --fail-on after the fix', run('scan-forms.mjs', ['after', '--fail-on']).status === 0)

const uploadBeforeRun = run('scan-forms.mjs', ['uploads/before', '--json'])
const uploadBefore = json(uploadBeforeRun)
const uploadRules = ruleSet(uploadBefore)
check('file input without accept is reported', uploadRules.has('file-input-missing-accept'))
check('file input without a size limit is reported', uploadRules.has('file-input-missing-size-limit'))

check('file input with accept and a size limit passes', run('scan-forms.mjs', ['uploads/after', '--json']).output.includes('"findings": []'))

const suppressed = json(run('scan-forms.mjs', ['suppressed', '--json']))
check('form-ok suppresses a finding', (suppressed?.findings ?? []).length === 0, JSON.stringify(suppressed?.findings))

const ignoredRun = run('scan-forms.mjs', ['before', '--json', '--ignore', 'input-missing-autocomplete'])
const ignored = json(ignoredRun)
check(
  '--ignore removes a rule',
  ignored !== null && !ruleSet(ignored).has('input-missing-autocomplete'),
  JSON.stringify([...ruleSet(ignored)]),
)

const alignedRun = run('check-form-schema.mjs', [
  '--schema', 'after/schema.ts',
  '--form', 'after/CheckoutForm.tsx',
  '--json',
])
const aligned = json(alignedRun)
check('schema checker parses the aligned pair', aligned !== null, alignedRun.output.slice(0, 400))
check('aligned schema and form have no issues', (aligned?.issues ?? []).length === 0, JSON.stringify(aligned?.issues))
check('schema checker exits 0 for an aligned pair with --fail-on', run('check-form-schema.mjs', [
  '--schema', 'after/schema.ts',
  '--form', 'after/CheckoutForm.tsx',
  '--fail-on',
]).status === 0)

const driftRun = run('check-form-schema.mjs', [
  '--schema', 'drift/schema.ts',
  '--form', 'drift/CheckoutForm.tsx',
  '--json',
])
const drift = json(driftRun)
check('schema checker parses the drift pair', drift !== null, driftRun.output.slice(0, 400))
check('drift reports three issues', (drift?.issues ?? []).length === 3, JSON.stringify(drift?.issues))
check(
  'drift reports a schema field missing from the form',
  (drift?.issues ?? []).some((issue) => issue.rule === 'missing-in-form' && issue.field === 'phone'),
)
check(
  'drift reports a form field missing from the schema',
  (drift?.issues ?? []).some((issue) => issue.rule === 'missing-in-schema' && issue.field === 'nickname'),
)
check(
  'drift reports a required/optional mismatch',
  (drift?.issues ?? []).some((issue) => issue.rule === 'required-mismatch' && issue.field === 'coupon'),
)
check('schema checker exits 1 for drift with --fail-on', run('check-form-schema.mjs', [
  '--schema', 'drift/schema.ts',
  '--form', 'drift/CheckoutForm.tsx',
  '--fail-on',
]).status === 1)
check('schema checker requires both arguments', run('check-form-schema.mjs', ['--json']).status === 2)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
