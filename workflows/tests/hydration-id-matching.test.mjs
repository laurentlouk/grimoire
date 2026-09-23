// ════════════════════════════════════════════════════════════════════════════
//  Regression tests — hydration id↔ticket matching + replan REVISE hardening
//  (orchestrate-loop.js)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/hydration-id-matching.test.mjs
//
//  Two failure modes observed on real runs:
//    • the hydrator returned a fully-formed task with id "1.1" and the tracker
//      id in ticket "PROJ-660"; the scheduler indexed it by t.id and looked it
//      up by the tracker id → a VALID hydration read as HYDRATION_MISSING, the
//      issue was marked failed, a replan was burned.
//    • the replanner's REVISE leaked its task list into `reason` as text, so
//      tasks was empty, nothing requeued, and the loop halted.
//
//  What this locks down:
//    • a hydrated task is found by EITHER its id or its ticket, and lands under
//      the scheduler's tracker id (dependsOn/landedIds/done all match on it)
//    • a REVISE with zero tasks is retried once with a correction, and a good
//      second response requeues normally
//    • two empty REVISEs in a row still halt (no infinite retry)
//    • preview with {specPath, planPath, project, repos} dispatches ONLY the
//      index agent
//
//  Same harness contract as workflow-gates.test.mjs: scripted agent stubs keyed
//  by dispatch label.
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const load = (f) => readFileSync(`${DIR}/${f}`, 'utf8').replace(/^export const meta/m, 'const meta')
const body = load('orchestrate-loop.js')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

async function run(scenario, args, responder, src = body) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const pipeline = async () => { throw new Error('pipeline not used') }
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', src)
  const logs = []
  const result = await fn(agent, parallel, pipeline, (m) => logs.push(m), () => {}, args,
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  return { result, calls, logs }
}

const REPOS = [
  { name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: { kind: 'command', run: 'make e2e', stamp: 'tests/e2e/.e2e-green' } },
  { name: 'mobile', agent: 'app-engineer', tags: ['mobile'], gate: { kind: 'command', run: 'npm run smoke', when: { pathsMatching: ['native/'] } } },
  { name: 'infra', agent: 'infra-engineer', tags: ['infra'], gate: null },
]
// The newer rungs (precheck, finding verification, decision journal) are OFF here so these
// cases keep asserting the exact dispatch sequence they were written for; they are covered
// on their own in harness-v06.test.mjs.
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-600', repos: REPOS, precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const IMPL_OK = { status: 'DONE', summary: 's', commits: ['aaaaaaa'], baseSha: '0000000', headSha: 'aaaaaaa' }
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const GATE_OK = { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/1' }

// One slice, two mobile issues chained by dependsOn — all ids are tracker ids.
const INDEX = {
  slices: [{
    slice: 1, sliceLabel: 'v',
    issues: [
      { id: 'PROJ-660', title: 'first', repo: 'mobile', state: 'todo', dependsOn: [] },
      { id: 'PROJ-661', title: 'second', repo: 'mobile', state: 'todo', dependsOn: ['PROJ-660'] },
    ],
  }],
}
// The buggy hydrator shape observed live: plan-style id, tracker id only in ticket.
const mismatched = (ticket, n, dependsOn = []) => ({
  id: `1.${n}`, ticket, repo: 'mobile', agent: 'app-engineer', slice: 1, sliceLabel: 'v',
  order: n, taskText: 'Build the thing', deferred: false, branch: 'feat/x', dependsOn,
})
const hydrateByPrompt = (prompt) => ({
  tasks: [
    ...(prompt.includes('- PROJ-660 ') ? [mismatched('PROJ-660', 1)] : []),
    ...(prompt.includes('- PROJ-661 ') ? [mismatched('PROJ-661', 2, ['PROJ-660'])] : []),
  ],
})

// ══════ 1 · a hydrator returning plan-style ids must NOT read as HYDRATION_MISSING ══════
{
  const { result, calls } = await run('1 · id in ticket, not id → still matched, lands under the tracker id',
    { ...INPUTS, execute: true },
    (label, prompt) => {
      if (label === 'parse-index') return INDEX
      if (label.startsWith('hydrate:')) return hydrateByPrompt(prompt)
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  ok(!result.needsAttention.some((r) => r.status === 'HYDRATION_MISSING'), 'no HYDRATION_MISSING for a valid hydration')
  ok(result.done.length === 2, 'both issues landed')
  ok(result.done.every((r) => /^PROJ-/.test(r.id)), 'done tasks carry the TRACKER ids, not the plan-style ones')
  ok(calls.some((c) => c.label === 'impl:PROJ-660') && calls.some((c) => c.label === 'impl:PROJ-661'),
    'tasks were normalized to the tracker id BEFORE dispatch (impl labels)')
  ok(!calls.some((c) => c.label.startsWith('replan')), 'no replan was burned')
  ok(calls.filter((c) => c.label.startsWith('hydrate:')).length === 2, 'the dependent hydrated in its own cycle (dependsOn unblocked by the landed tracker id)')
  ok(!result.halt, 'the run did not halt')
}

// ══════ 2 · replan REVISE with zero tasks is retried once, a good retry requeues ══════
{
  let implCalls = 0
  const { result, calls } = await run('2 · empty REVISE → one retry → requeued and landed',
    { ...INPUTS, execute: true },
    (label) => {
      if (label === 'parse-index') return { slices: [{ slice: 1, sliceLabel: 'v', issues: [{ id: 'PROJ-700', title: 't', repo: 'mobile', state: 'todo', dependsOn: [] }] }] }
      if (label.startsWith('hydrate:')) return { tasks: [mismatched('PROJ-700', 1)] }
      if (label.startsWith('impl:')) { implCalls++; return implCalls === 1 ? { status: 'BLOCKED', summary: 'flaky' } : IMPL_OK }
      if (label === 'replan#1') return { decision: 'REVISE', reason: 'tasks accidentally serialized here', learnings: ['x'], tasks: [] }
      if (label === 'replan#1-retry') return { decision: 'REVISE', reason: 'retry the task', learnings: [], tasks: [mismatched('PROJ-700', 1)] }
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  ok(calls.some((c) => c.label === 'replan#1-retry'), 'the empty REVISE triggered exactly one planner retry')
  ok(calls.filter((c) => c.label.startsWith('replan')).length === 2, 'no further replan dispatches')
  ok(result.done.length === 1 && result.done[0].id === 'PROJ-700', 'the requeued task landed under its tracker id (ticket won over the planner-invented id)')
  ok(!result.halt, 'the run did not halt')
}

// ══════ 3 · two empty REVISEs in a row still halt — the retry is bounded ══════
{
  const { result, calls } = await run('3 · empty REVISE twice → halt, no infinite retry',
    { ...INPUTS, execute: true },
    (label) => {
      if (label === 'parse-index') return { slices: [{ slice: 1, sliceLabel: 'v', issues: [{ id: 'PROJ-700', title: 't', repo: 'mobile', state: 'todo', dependsOn: [] }] }] }
      if (label.startsWith('hydrate:')) return { tasks: [mismatched('PROJ-700', 1)] }
      if (label.startsWith('impl:')) return { status: 'BLOCKED', summary: 'flaky' }
      if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'still leaking', learnings: [], tasks: [] }
      return V('PASS')
    })
  ok(calls.filter((c) => c.label.startsWith('replan#1')).length === 2, 'exactly one retry per replan round (original + retry)')
  ok(result.halt && /requeued nothing/.test(result.halt.reason), 'the run halted with the requeued-nothing reason')
}

// ══════ 4 · preview with the full input set dispatches only the index ══════
{
  const { result, calls } = await run('4 · preview → index only',
    { ...INPUTS },
    (label) => {
      if (label === 'parse-index') return INDEX
      throw new Error(`should not dispatch beyond the index: ${label}`)
    })
  ok(result.preview === true && calls.length === 1, 'exactly one dispatch, and it previewed')
  ok(result.plan[0].issues.find((i) => i.id === 'PROJ-661').startable === false, 'a blocked issue is not startable')
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
