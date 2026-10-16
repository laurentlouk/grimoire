#!/usr/bin/env node
// grimoire · test runner. Runs every workflows/tests/*.test.mjs, hooks/scripts/guard.test.mjs,
// scripts/*.test.mjs and tools/graph/tests/*.test.mjs, in parallel, then the timing-sensitive files
// one at a time. Each file's output is printed whole when it ends, and every failure is listed at the
// end. The graph tests skip locally without the parser runtime (npm ci --prefix tools/graph).
//   Run:  node scripts/run-tests.mjs              (or: npm test)
//         node scripts/run-tests.mjs --fast       (or: npm run test:fast) — without the slow loop-durability files
//         node scripts/run-tests.mjs --jobs 4     (or GRIMOIRE_TEST_JOBS=4) — parallel files at once, default: the CPU count
//         node scripts/run-tests.mjs <file>…     — only these files
import { readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tests = (dir) => { try { return readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f)) } catch { return [] } }
const ALL = [...tests('workflows/tests'), ...['hooks/scripts/guard.test.mjs'].filter((f) => existsSync(path.join(ROOT, f))), ...tests('scripts'), ...tests('tools/graph/tests')]

// Lock and concurrency trials that count overlaps between real processes: they run alone, after the
// rest, so a busy machine cannot make them flaky.
const SERIAL = new Set(['run-durability-final', 'run-durability-concurrency', 'run-durability-journal'].map((n) => `workflows/tests/${n}.test.mjs`))
// The loop-durability files that drive real git sandboxes and shells for most of the suite's time.
// `--fast` leaves them out for quick local iteration; CI and `npm test` always run them.
const SLOW = new Set(['hardening', 'followups', 'delivery-fix', 'final', 'statewrite', 'resume'].map((n) => `workflows/tests/run-durability-${n}.test.mjs`))

const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const fast = argv.includes('--fast'); if (fast) argv.splice(argv.indexOf('--fast'), 1)
const jobsArg = flag('--jobs') ?? process.env.GRIMOIRE_TEST_JOBS
const JOBS = Math.max(1, Number.parseInt(jobsArg, 10) || availableParallelism())
const picked = argv.length ? argv.map((f) => path.relative(ROOT, path.resolve(f))) : ALL.filter((f) => !(fast && SLOW.has(f)))
for (const f of picked) if (!existsSync(path.join(ROOT, f))) { console.error(`run-tests: no such test file: ${f}`); process.exit(2) }

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => out.push(d))
    child.on('close', (code, signal) => {
      const sec = ((Date.now() - t0) / 1000).toFixed(1)
      process.stdout.write(`\n▶ ${file} (${sec} s)\n${Buffer.concat(out).toString()}`)
      resolve({ file, ok: code === 0, how: code ?? signal, sec })
    })
  })
}

async function pool(files, width) {
  const results = []
  let next = 0
  const worker = async () => { while (next < files.length) results.push(await run(files[next++])) }
  await Promise.all(Array.from({ length: Math.min(width, files.length) }, worker))
  return results
}

const t0 = Date.now()
const results = [
  ...await pool(picked.filter((f) => !SERIAL.has(f)), JOBS),
  ...await pool(picked.filter((f) => SERIAL.has(f)), 1),
]
const failed = results.filter((r) => !r.ok)
const total = ((Date.now() - t0) / 1000).toFixed(1)
const skipped = fast ? ` (--fast: ${[...SLOW].filter((f) => ALL.includes(f)).length} slow file(s) left out)` : ''
if (failed.length) {
  console.log(`\n✗ ${failed.length} of ${results.length} test file(s) failed in ${total} s${skipped}:`)
  for (const r of failed) console.log(`  ✗ ${r.file} (exit ${r.how})`)
  process.exit(1)
}
console.log(`\n✓ ${results.length} test file(s) passed in ${total} s, ${JOBS} at a time${skipped}`)
