#!/usr/bin/env node
/**
 * End-to-end check for the saas-authz skill.
 *
 * Run from the repository root:
 *   node examples/authz/test.mjs
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const scripts = join(repo, 'saas-authz', 'scripts')

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

console.log('\nsaas-authz | end-to-end check\n')

// 1. The scanner flags data access without a tenant scope.
const scanBefore = run('scan-tenant-scope.mjs', ['before', '--json'])
const before = json(scanBefore)
check('scanner parses the seeded queries', before !== null, scanBefore.output.slice(0, 400))
const findings = before?.findings ?? []
check('scanner flags every unscoped call', findings.length >= 4, `found ${findings.length}`)
check('scanner flags a write', findings.some((f) => f.severity === 'write'))
check(
  'scanner flags raw SQL',
  findings.some((f) => f.rule === 'raw'),
)

// 2. Scoped queries pass.
const scanAfter = run('scan-tenant-scope.mjs', ['after', '--json'])
const after = json(scanAfter)
check('scanner parses the scoped queries', after !== null, scanAfter.output.slice(0, 400))
check('scanner reports zero candidates after scoping', (after?.findings ?? []).length === 0, `found ${after?.findings?.length}`)

// 3. --fail-on-match turns candidates into a non-zero exit.
check('scanner exits 1 with --fail-on-match', run('scan-tenant-scope.mjs', ['before', '--fail-on-match']).status === 1)
check('scanner exits 0 for scoped code with --fail-on-match', run('scan-tenant-scope.mjs', ['after', '--fail-on-match']).status === 0)

// 4. The RLS checker rejects the seeded migrations.
const rlsBeforeRun = run('check-rls.mjs', ['before', '--json'])
const rlsBefore = json(rlsBeforeRun)
check('RLS checker parses the seeded migrations', rlsBefore !== null, rlsBeforeRun.output.slice(0, 400))
check('RLS checker fails the seeded migrations', rlsBeforeRun.status === 1)
check('RLS checker reports a table without RLS', (rlsBefore?.errors ?? []).some((e) => e.message === 'RLS is not enabled'))
check(
  'RLS checker reports a permissive policy',
  (rlsBefore?.errors ?? []).some((e) => e.message.includes('allows every row')),
)
check('RLS checker warns when RLS is not forced', (rlsBefore?.warnings ?? []).some((w) => w.message.includes('not forced')))

// 5. The hardened migrations pass.
const rlsAfterRun = run('check-rls.mjs', ['after', '--json'])
const rlsAfter = json(rlsAfterRun)
check('RLS checker parses the hardened migrations', rlsAfter !== null, rlsAfterRun.output.slice(0, 400))
check('RLS checker passes the hardened migrations', rlsAfterRun.status === 0)
check('RLS checker reports no errors', (rlsAfter?.errors ?? []).length === 0, JSON.stringify(rlsAfter?.errors))
check('RLS checker reports no warnings', (rlsAfter?.warnings ?? []).length === 0, JSON.stringify(rlsAfter?.warnings))
check(
  'RLS checker ignores global tables',
  (rlsAfter?.errors ?? []).every((e) => e.table !== 'countries'),
)

// 6. --strict promotes warnings to failures.
const warn = run('check-rls.mjs', ['warn', '--json'])
check('RLS warnings do not fail by default', warn.status === 0)
check('RLS checker reports the warning-only fixture', (json(warn)?.warnings ?? []).length === 1)
check(
  'RLS checker honors --strict',
  run('check-rls.mjs', ['warn', '--strict']).status === 1,
)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
