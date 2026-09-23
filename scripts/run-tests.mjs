#!/usr/bin/env node
// grimoire · test runner. Runs every workflows/tests/*.test.mjs, hooks/scripts/guard.test.mjs
// and scripts/*.test.mjs, one at a time, and stops at the first failing file.
//   Run:  node scripts/run-tests.mjs     (or: npm test)
import { readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tests = (dir) => { try { return readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f)) } catch { return [] } }
const files = [...tests('workflows/tests'), ...['hooks/scripts/guard.test.mjs'].filter((f) => existsSync(path.join(ROOT, f))), ...tests('scripts')]

for (const f of files) {
  console.log(`\n▶ ${f}`)
  const r = spawnSync(process.execPath, [f], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) {
    console.log(`\n✗ ${f} failed (exit ${r.status ?? r.signal})`)
    process.exit(1)
  }
}
console.log(`\n✓ ${files.length} test file(s) passed`)
