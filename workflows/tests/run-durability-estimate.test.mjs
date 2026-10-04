// ════════════════════════════════════════════════════════════════════════════
//  Run durability (0.9.0) · the preview's wall-clock estimate — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-estimate.test.mjs
//
//  Grounded in a real unattended run (one static-site repo, 10 issues in a strict blocked-by
//  chain, maxPerRepo 1) that was launched as "a few hours" and took about 29 h of run time over
//  three attempts, plus about 9 h waiting on the user. Its journal put the time in implementing
//  (12.7 h), reviewing (8.2 h), hydration (3.6 h), replans (2.2 h), prechecks (2.1 h) and journal
//  and ledger writes (1.3 h). Nothing in the preview said that a chain runs one task at a time
//  whatever maxPerRepo is. The preview now returns an estimate:
//    • low  = (startup + max(critical path, ⌈largest repo / maxPerRepo⌉) × perTask.low  + terminal.low)  / 60
//    • high = (startup + max(critical path, largest repo)               × perTask.high + terminal.high) / 60
//    • defaults perTask 40–110 min, terminal 30–90 min, startup 10 min; {estimatePerTaskMin} overrides
//  For that project's shape (10 tasks, one chain, one repo) that is ≈ 7–20 h.
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget).
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const near = (a, b, tol, m) => ok(typeof a === 'number' && Math.abs(a - b) <= tol, `${m} (got ${a})`)

const REPOS = [
  { name: 'site', path: '.', agent: 'site-engineer', tags: ['web'], gate: null },
  { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null },
]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-900', repos: REPOS }

const issue = (id, repo, dependsOn = [], state = 'todo') => ({ id, repo, dependsOn, state })
const chain = (n, repo = 'site') => Array.from({ length: n }, (_, k) => issue(`#${k + 4}`, repo, k ? [`#${k + 3}`] : []))

async function preview(scenario, issues, args = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label || '?', prompt, opts })
    if (opts.label === 'parse-index') {
      return { slices: [{ slice: 1, sliceLabel: 'foundation', issues: issues.map((i) => ({ title: `Title of ${i.id}`, assignee: '', ...i })) }], hookProblems: [] }
    }
    throw new Error(`a preview dispatched ${opts.label}`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  return { result, logs, labels: calls.map((c) => c.label), est: result.estimate || {} }
}

// ══════════════ 1 · the real run's shape: 10 issues, one strict chain, one repo ══════════════
{
  const { result, logs, labels, est } = await preview('1a · 10-issue blocked-by chain in one repo, defaults', chain(10))
  ok(result.preview === true, 'a preview')
  eq(labels, ['parse-index'], 'the preview still dispatches only the slice index')
  eq([est.tasks, est.criticalPath, est.largestRepo], [10, 10, 10], '10 tasks, critical path 10, largest repo 10')
  eq(est.perTaskMin, { low: 40, high: 110 }, 'default per-task bounds 40–110 min')
  eq([est.terminalMin, est.startupMin], [{ low: 30, high: 90 }, 10], 'default terminal 30–90 min and startup 10 min')
  near(est.hours && est.hours.low, 7, 0.5, 'low ≈ 7 h')
  near(est.hours && est.hours.high, 20, 0.5, 'high ≈ 20 h')
  ok(/critical path 10/.test(est.basis) && /one task at a time whatever maxPerRepo is/.test(est.basis), 'the basis explains why a chain is serial')
  ok(new RegExp(`≈ ${est.hours.low}–${est.hours.high} h`).test(result.note), 'the note carries the estimate')
  ok(logs.some((l) => /⏱ estimated wall clock ≈ 7\.3–20 h/.test(l)), 'the estimate is logged')
}
{
  const { est } = await preview('1b · the same chain at maxPerRepo 1 (as launched)', chain(10), { maxPerRepo: 1 })
  eq([est.repoSerial, est.hours && est.hours.low, est.hours && est.hours.high], [10, 7.3, 20], 'same ≈ 7.3–20 h: a chain gains nothing from maxPerRepo')
}

// ══════════════ 2 · {estimatePerTaskMin} overrides the per-task bounds ══════════════
{
  const { est } = await preview('2a · {estimatePerTaskMin:{low:20, high:60}}', chain(10), { estimatePerTaskMin: { low: 20, high: 60 } })
  eq(est.perTaskMin, { low: 20, high: 60 }, 'the per-task bounds are the override')
  eq(est.hours, { low: 4, high: 11.7 }, 'hours follow it: (10 + 10×20 + 30)/60 and (10 + 10×60 + 90)/60')
  ok(/\(estimatePerTaskMin\)/.test(est.basis), 'the basis says the minutes came from the override')
}
{
  const { est } = await preview('2b · a single number sets both bounds', chain(10), { estimatePerTaskMin: 30 })
  eq(est.perTaskMin, { low: 30, high: 30 }, 'low = high = 30')
  eq(est.hours, { low: 5.7, high: 6.7 }, 'the terminal bounds still make it a range')
}
{
  const { est } = await preview('2c · only low given, above the default high', chain(10), { estimatePerTaskMin: { low: 120 } })
  eq(est.perTaskMin, { low: 120, high: 120 }, 'high is raised to low, never below it')
}
{
  for (const bad of [-5, 0, 'fast', { low: -1 }]) {
    const { est, logs } = await preview(`2d · invalid override ${JSON.stringify(bad)} is ignored`, chain(10), { estimatePerTaskMin: bad })
    eq(est.perTaskMin, { low: 40, high: 110 }, 'the defaults stay')
    ok(logs.some((l) => /estimatePerTaskMin ignored/.test(l)) && /measured on 0\.8\.x runs/.test(est.basis), 'a warning is logged and the basis names the defaults')
  }
}

// ══════════════ 3 · other shapes ══════════════
{
  const flat = Array.from({ length: 10 }, (_, k) => issue(`P-${k + 1}`, 'site'))
  const { est } = await preview('3a · 10 independent issues in one repo, maxPerRepo 3', flat)
  eq([est.criticalPath, est.repoSerial, est.largestRepo], [1, 4, 10], 'critical path 1, ⌈10/3⌉ = 4 serial steps at best, 10 at worst')
  eq(est.hours, { low: 3.3, high: 20 }, 'low lets maxPerRepo run together; high, files unknown, runs them one after another')
}
{
  const issues = [
    issue('D-0', 'site', [], 'done'),
    issue('A-1', 'site', ['D-0']), issue('B-1', 'api', ['A-1']), issue('A-2', 'site', ['B-1']),
    issue('B-2', 'api'), issue('X-1', 'api', ['OTHER-9']),
  ]
  const { est } = await preview('3b · a chain across two repos; absorbed and out-of-project blockers do not count', issues)
  eq([est.tasks, est.criticalPath, est.largestRepo], [5, 3, 3], '5 tasks to run; chain A-1 → B-1 → A-2 is 3 long (D-0 is done, OTHER-9 is elsewhere)')
  ok(!JSON.stringify(est).includes('D-0'), 'the absorbed issue is not counted as work')
}
{
  const { est } = await preview('3c · a dependency cycle does not hang the preview', [issue('C-1', 'site', ['C-2']), issue('C-2', 'site', ['C-1'])])
  ok(Number.isFinite(est.criticalPath) && est.criticalPath >= 1 && est.criticalPath <= 2, `a cycle is cut (critical path ${est.criticalPath})`)
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
