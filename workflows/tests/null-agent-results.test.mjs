// ════════════════════════════════════════════════════════════════════════════
//  Regression tests — dead agents must evict, never re-queue (orchestrate-loop.js)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/null-agent-results.test.mjs
//
//  Observed live: an org spend limit was hit mid-run, every dispatched agent
//  died instantly, and the runtime resolved each slot to null. Nulls were
//  dropped BEFORE the bookkeeping that evicts a task from the pending set, so
//  the scheduler re-selected the same tasks as ready and re-dispatched them in
//  a tight loop until the runtime's agent cap aborted the run.
//
//  What this locks down:
//    • a dead agent evicts its task as DIED — each task is dispatched exactly
//      once, the run terminates
//    • the DIED failure feeds the replanner, whose HALT ends the run cleanly
//    • three consecutive all-dead settles trip a circuit breaker with a clear
//      instantly-dying reason (spend limit / API outage), never a spin, and the
//      breaker beats the replanner (a dead API is not fed replans)
//
//  Same harness contract as workflow-gates.test.mjs: scripted agent stubs keyed
//  by dispatch label. Agent death is modeled by the responder returning null for
//  a dispatch, exactly what agent() yields.
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const load = (f) => readFileSync(`${DIR}/${f}`, 'utf8').replace(/^export const meta/m, 'const meta')
const body = load('orchestrate-loop.js')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

// CALL_CAP is a test-harness backstop only: pre-fix the scheduler spins forever,
// and without a cap the test would hang instead of failing.
const CALL_CAP = 60

async function run(scenario, args, responder, { src = body } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (calls.length > CALL_CAP) throw new Error(`harness call cap (${CALL_CAP}) exceeded — the scheduler is spinning`)
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const pipeline = async () => { throw new Error('pipeline not used') }
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', src)
  const logs = []
  let result
  try {
    result = await fn(agent, parallel, pipeline, (m) => logs.push(m), () => {}, args,
      { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  } catch (e) {
    result = { __crashed: String(e && e.message) }
  }
  console.log(`\n── ${scenario}${result.__crashed ? ` — CRASHED: ${result.__crashed}` : ''}`)
  return { result, calls, logs }
}

const REPOS = [
  { name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: { kind: 'command', run: 'make e2e' } },
  { name: 'mobile', agent: 'app-engineer', tags: ['mobile'], gate: { kind: 'command', run: 'npm run smoke', when: { pathsMatching: ['native/'] } } },
  { name: 'infra', agent: 'infra-engineer', tags: ['infra'], gate: null },
]
// The newer rungs (precheck, finding verification, decision journal) are OFF here so these
// cases keep asserting the exact dispatch sequence they were written for; they are covered
// on their own in harness-v06.test.mjs.
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-600', repos: REPOS, precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const task = (id, n, dependsOn = []) => ({
  id, ticket: id, repo: 'mobile', agent: 'app-engineer', slice: 1, sliceLabel: 'v',
  order: n, taskText: 'Build the thing', deferred: false, branch: 'feat/x', dependsOn,
})
const implCount = (calls, id) => calls.filter((c) => c.label === `impl:${id}`).length

// ══════ 1 · a dead agent evicts as DIED and the run ends via replan, not a spin ══════
{
  const INDEX = {
    slices: [{
      slice: 1, sliceLabel: 'v',
      issues: [{ id: 'PROJ-660', title: 'a', repo: 'mobile', state: 'todo', dependsOn: [] }],
    }],
  }
  const { result, calls } = await run('1 · dead agent → DIED failure feeds the replanner once',
    { ...INPUTS, execute: true },
    (label) => {
      if (label === 'parse-index') return INDEX
      if (label.startsWith('hydrate:')) return { tasks: [task('PROJ-660', 1)] }
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'agents are dying — waiting on the org limit', learnings: [], tasks: [] }
      if (label.startsWith('impl:')) return null // the runtime lost the agent (spend limit / outage)
      return { status: 'DONE', summary: 's' }
    })
  ok(implCount(calls, 'PROJ-660') === 1, 'the task dispatched exactly once')
  ok((result.needsAttention || []).some((r) => r.id === 'PROJ-660' && r.status === 'DIED'), 'the dead task surfaced as a DIED failure')
  ok(result.halt != null, 'the run halted instead of spinning')
  const replan = calls.find((c) => c.label === 'replan#1')
  ok(/died without returning a result/.test(replan.prompt), 'the replan brief explains a DIED result as an infrastructure failure, not a verdict')
}

// ══════ 2 · consecutive dead dispatches trip the circuit breaker ══════
// Three disjoint-file tasks in one repo → all in flight at once, all agents dead →
// three consecutive DIED settles set the halt, dispatching stops, no replan is fed.
{
  const INDEX = {
    slices: [{
      slice: 1, sliceLabel: 'v',
      issues: [
        { id: 'PROJ-660', title: 'a', repo: 'mobile', state: 'todo', dependsOn: [] },
        { id: 'PROJ-661', title: 'b', repo: 'mobile', state: 'todo', dependsOn: [] },
        { id: 'PROJ-662', title: 'c', repo: 'mobile', state: 'todo', dependsOn: [] },
      ],
    }],
  }
  const t = (id, file) => ({ ...task(id, 1), files: [file] })
  const { result, calls } = await run('2 · 3 consecutive dead dispatches → circuit breaker, no replan',
    { ...INPUTS, execute: true },
    (label) => {
      if (label === 'parse-index') return INDEX
      if (label.startsWith('hydrate:')) return { tasks: [t('PROJ-660', 'app/a.tsx — x'), t('PROJ-661', 'app/b.tsx — y'), t('PROJ-662', 'app/c.tsx — z')] }
      if (label.startsWith('impl:')) return null
      return { status: 'DONE', summary: 's' }
    })
  ok(result.halt && /dying instantly|spend limit|outage/i.test(result.halt.reason), `halted with an instantly-dying reason (got: ${result.halt ? result.halt.reason : 'none'})`)
  ok(!calls.some((c) => c.label.startsWith('replan')), 'the breaker beat the replanner — a dead API is not fed replans')
  ok(['PROJ-660', 'PROJ-661', 'PROJ-662'].every((id) => implCount(calls, id) === 1), 'each task dispatched exactly once')
}

// ══════ 3 · a dead terminal slot books as GATE_FAILED, mapped back to its repo ══════
{
  const INDEX = {
    slices: [{
      slice: 1, sliceLabel: 'v',
      issues: [{ id: 'PROJ-670', title: 'a', repo: 'api', state: 'todo', dependsOn: [] }],
    }],
  }
  const { result } = await run('3 · a dead gate dispatch is GATE_FAILED for the right repo',
    { ...INPUTS, execute: true },
    (label) => {
      if (label === 'parse-index') return INDEX
      if (label.startsWith('hydrate:')) return { tasks: [{ ...task('PROJ-670', 1), repo: 'api', agent: 'backend-engineer' }] }
      if (label.startsWith('impl:')) return { status: 'DONE', summary: 's', commits: ['aaaaaaa'], headSha: 'aaaaaaa' }
      if (label.startsWith('gate:')) return null
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'gate dispatch keeps dying', learnings: [] }
      return { verdict: 'PASS', findings: [], summary: 'PASS' }
    })
  ok(result.needsAttention.some((r) => r.repo === 'api' && r.status === 'GATE_FAILED'), 'the null slot is booked as GATE_FAILED against its repo')
  ok(result.prs.length === 0, 'and no PR is reported')
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
