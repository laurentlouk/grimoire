// ════════════════════════════════════════════════════════════════════════════
//  Run durability: concurrency (0.9.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-concurrency.test.mjs
//
//  An adversarial review of the 0.9.0 engine raced its asynchronous paths against each other:
//  slots of one final wave, a wedged writer against the end of the run, a prefetch against a
//  replan, a dead journal writer against the final flush. The runtime cannot cancel an agent, so
//  every result that arrives late has to land somewhere sensible:
//    • A FINAL WAVE THAT NEVER RETURNED — one slot wedged, the other then returned normally, and
//      nothing woke the wave to book it (K-1)
//    • A WEDGED SLOT DISPATCHED TWICE — its late result went nowhere, so its repo was gated again
//      once the fence released: a second push, a second PR, the first PR URL lost (K-2)
//    • A STALE PREFETCH OVER A REPLAN — a hydration started before a replan landed after it and
//      overwrote the task the replan had just revised, in a repo that did not fail (K-3)
//    • A WRITER RETURNING AFTER THE RUN — its task flowed on into reviews that could not run (K-4)
//    • A DEAD JOURNAL WRITER — every queued chunk waited out its 8-minute limit at the end (K-5)
//    • A MISLEADING HALT — a replan whose tasks were all still running said it "requeued nothing" (K-6)
//    • A LEAKED CLAIM — issues a prefetch claimed were never handed back when the run halted (K-7)
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget).
//  Timers are real: limits are fractional minutes (0.001 min = 60 ms). A run that does not return
//  within its guard is reported as HUNG instead of holding the suite.
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
const HANG = () => new Promise(() => {})

const API = { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }
const INFRA = { name: 'infra', path: 'repositories/infra', agent: 'infra-engineer', tags: ['infra'], gate: null }
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: [API] }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const FAST = { agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.005 } // soft 60 ms · writer hard 300 ms
const PROBE = { toolLatencySec: 3, repoRoots: [{ name: 'api', root: '/home/ana/ws/repositories/api', branch: 'main' }], home: '/home/ana' }

const T = (id, extra = {}) => ({ id, ticket: id, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: `Build ${id}`, deferred: false, files: [`src/${id.toLowerCase()}.ts — add it`], ...extra })
const IN = (id, extra = {}) => T(id, { repo: 'infra', agent: 'infra-engineer', files: [`infra/${id.toLowerCase()}.tf — add it`], ...extra })
const IMPL_OK = { status: 'DONE', summary: 'built it', commits: ['aaaaaaa'], baseSha: '0000000', startSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const PR = (n) => ({ status: 'DONE', summary: 'green', prUrl: `https://github.com/x/y/pull/${n}` })
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const happy = (label) => {
  if (label.startsWith('impl:') || label.startsWith('fix:')) return IMPL_OK
  if (label.startsWith('gate:')) return PR(9)
  if (label.startsWith('precheck:')) return { verdict: 'PASS', problems: [] }
  if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'ccccccc' }
  if (label.startsWith('journal#')) return { runDir: '/tmp/x', lines: 0, bytes: 0 }
  return V('PASS')
}

const indexOf = (tasks, extra) => ({
  slices: [...new Set(tasks.map((t) => t.slice ?? 1))].sort((a, b) => a - b).map((s) => ({
    slice: s,
    sliceLabel: 'v',
    issues: tasks.filter((t) => (t.slice ?? 1) === s).map((t) => ({ id: t.id, title: `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })),
  })),
  hookProblems: [],
  ...extra,
})

// `hydrate(label, prompt, def)` may override a hydration (return undefined to keep the default).
// Hydrations return COPIES: the engine mutates the task objects it schedules.
async function run(scenario, tasks, responder, { args = {}, index = PROBE, hydrate, guardMs = 8000 } = {}) {
  const calls = []
  const t0 = Date.now()
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts, at: Date.now() - t0 })
    if (label === 'parse-index') return indexOf(tasks, index)
    if (label.startsWith('hydrate:')) {
      const def = () => ({ tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map((t) => ({ ...t })) })
      const h = hydrate ? hydrate(label, prompt, def) : undefined
      return h !== undefined ? h : def()
    }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return { reports: [], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], prUrl: '', summary: 'nothing' }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const p = fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  const result = await Promise.race([p, tick(guardMs).then(() => 'HUNG')])
  console.log(`\n── ${scenario}`)
  const labels = calls.map((c) => c.label)
  const hung = result === 'HUNG'
  ok(!hung, `the run returned (within ${guardMs} ms)`)
  return { result: hung ? null : result, hung, calls, logs, labels, ms: Date.now() - t0, prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}
const prsOf = (result) => ((result && result.prs) || []).map((p) => `${p.repo} ${p.pr}`)

// ══════════════ K-1 · a slot that finishes after another one wedged wakes the final wave ══════════════
{
  // gate:api never returns: it wedges at 300 ms. infra has a longer allowance (repos[].timeoutMin:
  // soft 240 ms, hard 480 ms) and its gate returns at 400 ms — after api wedged, before its own hard limit.
  const INFRA_SLOW = { ...INFRA, timeoutMin: 0.004 }
  const { result, labels, logs } = await run('K-1 · final wave: a slot that returns after the other slot wedged is booked; the run returns', [T('PROJ-1'), IN('PROJ-2')], (label) => {
    if (label === 'gate:api') return HANG()
    if (label === 'gate:infra') return later(400, PR(10))
    return happy(label)
  }, { args: { ...QUIET, ...FAST, repos: [API, INFRA_SLOW] }, guardMs: 6000 })
  eq(prsOf(result), ['infra https://github.com/x/y/pull/10'], "infra's PR is booked")
  eq(((result && result.needsAttention) || []).map((n) => `${n.id}:${n.status}`), ['api:gate:STILL_RUNNING'], 'api:gate is reported STILL_RUNNING')
  eq((result && result.halt && result.halt.kind) || null, 'wedged', 'the run halts as still running')
  ok(logs.some((l) => /⛔ final wave: api still running past the hard limit — booking the other slot\(s\) now/.test(l)), 'the wave returned once every open slot was wedged')
  eq(labels.filter((l) => l.startsWith('gate:')).sort(), ['gate:api', 'gate:infra'], 'each gate dispatched once')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
