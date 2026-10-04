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
//    • A READY PR OVER A FAILURE — a failed task with no pending dependents left its repo "drained":
//      the final wave gated it (and marked its PR ready) before the replan of that failure (K-8)
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
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false }, deliver: 'end', builtinEnvChecks: false } // ships and environment checks only where a case is about them
const FAST = { agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.005 } // soft 60 ms · writer hard 300 ms
const PATIENT = { timeouts: { reader: { soft: 0.05, hard: 0.2 } } } // readers (replan, ledger) wait 3 s / 12 s under FAST
const PROBE = { toolLatencySec: 3, repoRoots: [{ name: 'api', root: '/home/ana/ws/repositories/api', branch: 'main' }], home: '/home/ana' }

const T = (id, extra = {}) => ({ id, ticket: id, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: `Build ${id}`, deferred: false, files: [`src/${id.toLowerCase()}.ts — add it`], ...extra })
const IN = (id, extra = {}) => T(id, { repo: 'infra', agent: 'infra-engineer', files: [`infra/${id.toLowerCase()}.tf — add it`], ...extra })
const IMPL_OK = { status: 'DONE', summary: 'built it', commits: ['aaaaaaa'], baseSha: '0000000', startSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const PR = (n) => ({ status: 'DONE', summary: 'green', prUrl: `https://github.com/x/y/pull/${n}` })
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
// incremental delivery and environment checks (the 0.9.0 defaults), where a case needs them
const headOf = (p) => (/landed head `([0-9a-f]+)`/.exec(p) || [])[1]
const shipOk = (p) => ({ pushed: true, remoteHead: headOf(p), prUrl: 'https://github.com/x/y/pull/7', draft: true })
const envOk = (p) => ({ results: [...p.matchAll(/\bsay (?:'([^']+)'|(power)) /g)].map((m) => ({ name: m[1] || m[2], exit: 0, output: '' })) })
const happy = (label, p) => {
  if (label.startsWith('impl:') || label.startsWith('fix:')) return IMPL_OK
  if (label.startsWith('ship:')) return shipOk(p)
  if (label.startsWith('env:')) return envOk(p)
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
// Hydrations return COPIES: the engine mutates the task objects it schedules. `pre(label)` answers
// before the built-in stubs (ledger, harness-context…) when it returns anything but undefined.
async function run(scenario, tasks, responder, { args = {}, index = PROBE, hydrate, pre, guardMs = 8000 } = {}) {
  const calls = []
  const t0 = Date.now()
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts, at: Date.now() - t0 })
    const early = pre ? pre(label, prompt) : undefined
    if (early !== undefined) return early
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
const attention = (result) => ((result && result.needsAttention) || []).map((n) => `${n.id}:${n.status}`)

// The decision journal's events, from every journal# prompt: the first heredoc holds the chunk
// (JSON lines, or base64 of them once the payload is made opaque).
function journalEvents(calls) {
  const out = []
  for (const c of calls.filter((x) => x.label.startsWith('journal#'))) {
    const chunk = (/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/.exec(c.prompt) || [])[1] || ''
    const text = chunk.trim().startsWith('{') ? chunk : Buffer.from(chunk.replace(/\s+/g, ''), 'base64').toString('utf8')
    for (const line of text.split('\n').filter((l) => l.trim().startsWith('{'))) out.push(JSON.parse(line))
  }
  return out
}

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
  eq(attention(result), ['api:gate:STILL_RUNNING'], 'api:gate is reported STILL_RUNNING')
  eq((result && result.halt && result.halt.kind) || null, 'wedged', 'the run halts as still running')
  ok(logs.some((l) => /⛔ final wave: api still running past the hard limit — booking the other slot\(s\) now/.test(l)), 'the wave returned once every open slot was wedged')
  eq(labels.filter((l) => l.startsWith('gate:')).sort(), ['gate:api', 'gate:infra'], 'each gate dispatched once')
}

// ══════════════ K-2 · a wedged slot's late result is booked, and its gate never dispatched twice ══════════════
{
  // api lands, infra fails. The final wave gates api; gate:api wedges at 300 ms and the wave returns.
  // The replan for infra takes 500 ms; gate:api returns a valid PR meanwhile, at 600 ms.
  let tries = 0
  const { result, labels, logs } = await run('K-2a · gate:api returns during the replan: its PR is booked, api is not gated again', [T('PROJ-1'), IN('PROJ-2')], (label) => {
    if (label === 'gate:api') return later(600, PR(9))
    if (label === 'impl:PROJ-2') return tries++ === 0 ? { status: 'BLOCKED', summary: 'nope' } : IMPL_OK
    if (label.startsWith('replan#')) return later(500, { decision: 'REVISE', cause: 'harness', reason: 'retry infra', learnings: [], tasks: [IN('PROJ-2')] })
    if (label === 'gate:infra') return PR(10)
    return happy(label)
  }, { args: { ...QUIET, ...FAST, ...PATIENT, repos: [API, INFRA] } })
  eq(labels.filter((l) => l === 'gate:api').length, 1, 'gate:api dispatched once — never again once the fence released')
  eq(prsOf(result).sort(), ['api https://github.com/x/y/pull/9', 'infra https://github.com/x/y/pull/10'], 'both PRs are booked, the late one included')
  eq(attention(result), [], 'nothing needs attention, nothing STILL_RUNNING')
  eq((result && result.ungatedRepos) || null, [], 'no repo left ungated')
  eq((result && result.halt) || null, null, 'no halt')
  ok(logs.some((l) => /◎ api: its terminal slot returned after its final wave — DONE · https:\/\/github\.com\/x\/y\/pull\/9$/.test(l)), 'the late slot is logged as booked')
}
{
  // One repo. gate:api wedges at 300 ms, the run halts as still running; the ledger write takes 800 ms
  // and gate:api returns at 700 ms, after the loop has stopped dispatching.
  const { result, calls, logs } = await run('K-2b · gate:api returns after the loop ended: recorded in the result and the journal', [T('PROJ-1')], (label) => {
    if (label === 'gate:api') return later(700, PR(9))
    return happy(label)
  }, { args: { ...QUIET, ...FAST, ...PATIENT, telemetry: { enabled: true, flushEvery: 1000 } }, pre: (label) => (label === 'ledger' ? later(800, { path: 'runs/x.json', branch: 'harness/run-x' }) : undefined) })
  eq((result && result.halt && result.halt.kind) || null, 'wedged', 'the run halted as still running (the gate had not returned)')
  eq(prsOf(result), ['api https://github.com/x/y/pull/9'], 'its PR is in result.prs')
  eq(attention(result), [], 'it is no longer reported STILL_RUNNING')
  eq((result && result.ungatedRepos) || null, [], 'api is not reported ungated')
  ok(journalEvents(calls).some((e) => e.type === 'gate' && e.repo === 'api' && e.prUrl === 'https://github.com/x/y/pull/9'), 'the journal records its gate event')
  ok(logs.some((l) => /◎ api: its terminal slot returned after its final wave — DONE · .*\(recorded; the run had stopped dispatching\)/.test(l)), 'logged as recorded after the run stopped dispatching')
  eq(((result && result.telemetry.late) || []).filter((l) => l.label === 'gate:api').map((l) => l.outcome), ['accepted'], 'telemetry.late: the gate result was accepted (nothing is dispatched after a gate)')
}

// ══════════════ K-3 · a late prefetch never overwrites what a replan revised ══════════════
{
  // PROJ-3 (infra) depends on PROJ-1 (api) and is prefetched while PROJ-1 runs; the prefetch takes 500 ms.
  // PROJ-1 fails at 50 ms; the replan REVISES PROJ-3 (new text) and retries PROJ-1. infra did not fail.
  let tries = 0
  const { result, calls, prompt } = await run('K-3 · a prefetch that lands after a replan revised the same task (in a repo that did not fail) is dropped', [T('PROJ-1'), IN('PROJ-3', { dependsOn: ['PROJ-1'] })], (label, p) => {
    if (label === 'impl:PROJ-1') return tries++ === 0 ? later(50, { status: 'BLOCKED', summary: 'no' }) : later(800, IMPL_OK)
    if (label.startsWith('replan#')) return later(100, { decision: 'REVISE', cause: 'code', reason: 'retry; PROJ-3 changed', learnings: [], tasks: [T('PROJ-1'), IN('PROJ-3', { dependsOn: ['PROJ-1'], taskText: 'REVISED approach for PROJ-3' })] })
    return happy(label, p)
  }, { args: { ...QUIET, repos: [API, INFRA] }, hydrate: (label, _p, def) => (label === 'hydrate:p1' ? later(500, def()) : undefined) })
  const at = (l) => calls.findIndex((c) => c.label === l)
  const p1 = calls.find((c) => c.label === 'hydrate:p1')
  ok(!!p1 && p1.prompt.includes('- PROJ-3 ') && at('hydrate:p1') < at('replan#1'), 'PROJ-3 was prefetched before the replan')
  ok(/REVISED approach for PROJ-3/.test(prompt('impl:PROJ-3')), "impl:PROJ-3 is built from the replan's revision")
  ok(!/Build PROJ-3/.test(prompt('impl:PROJ-3')), 'not from the stale prefetch')
  ok(result && result.done.length === 2 && !result.halt, 'both landed')
}

// ══════════════ K-4 · a wedged writer that returns after the loop ended flows no further ══════════════
{
  // impl:PROJ-1 wedges at 300 ms and the run halts as still running; the final journal flush takes
  // 600 ms, and the implementer returns a valid result at 500 ms, while the run is ending.
  const { result, logs } = await run('K-4 · a wedged implementer returning after the run stopped dispatching: no review, no stats', [T('PROJ-1')], (label, p) => {
    if (label === 'impl:PROJ-1') return later(500, IMPL_OK)
    if (label.startsWith('journal#')) return later(600, { runDir: '/tmp/x', lines: 0, bytes: 0 })
    return happy(label, p)
  }, { args: { ...QUIET, ...FAST, telemetry: { enabled: true, flushEvery: 1000 } } })
  ok(logs.some((l) => /◎ \[late\] impl:PROJ-1 returned past its hard limit — after the run had stopped dispatching/.test(l)), 'its late result is logged as arriving after the run stopped dispatching')
  ok(!logs.some((l) => /PROJ-1: spec ∥ quality review|PROJ-1 \(api\): (spec|quality) review|reviewer\(s\) returned nothing/.test(l)), 'the task does not flow into reviews')
  eq(result && result.reviewStats.stages, 0, 'reviewStats untouched')
  eq(((result && result.telemetry.late) || []).filter((l) => l.label === 'impl:PROJ-1').map((l) => l.outcome), ['abandoned'], 'telemetry.late: abandoned')
  eq(attention(result), ['PROJ-1:STILL_RUNNING'], 'PROJ-1 reported STILL_RUNNING, as when the run stopped')
}

// ══════════════ K-5 · a dead journal writer stops being queued; the final chunk gets one attempt ══════════════
{
  // Every journal writer hangs and is given up on at 120 ms. With a chunk every 2 events, the run queues
  // many chunks: each used to wait out its limit in turn, all of them at the end of the run.
  const { result, calls, labels, logs } = await run('K-5 · two lost chunks in a row mark the writer dead: no more chunks are dispatched but the last', [T('PROJ-1'), T('PROJ-2'), T('PROJ-3')], (label, p) => {
    if (label.startsWith('journal#')) return HANG()
    return happy(label, p)
  }, { args: { ...QUIET, telemetry: { enabled: true, flushEvery: 2 }, timeouts: { journal: { soft: 0.001, hard: 0.002 } } } })
  const writes = labels.filter((l) => l.startsWith('journal#'))
  const j = (result && result.telemetry.journal) || {}
  eq(writes.length, 3, `three writer dispatches: two lost, then the final chunk (got ${writes.join(', ')})`)
  const end = journalEvents(calls.filter((c) => c.label === writes[writes.length - 1])).find((e) => e.type === 'run.end')
  ok(!!end, 'the last dispatch carries the final chunk (run.end)')
  ok(j.chunks > 3 && j.lost === j.chunks && j.written === 0, `every chunk is counted lost, dispatched or not (${j.lost}/${j.chunks})`)
  ok(!!end && j.lostEvents >= end.seq, `every event up to run.end (and any after it) is counted lost (${j.lostEvents} ≥ ${end && end.seq})`)
  eq(logs.filter((l) => /telemetry writer lost 2 chunks in a row — marked dead/.test(l)).length, 1, 'logged once')
}

// ══════════════ K-6 · a replan whose tasks are all still running halts as still running ══════════════
{
  // impl:PROJ-1 (api) never returns and wedges at 300 ms; PROJ-2 (infra) is BLOCKED. The replan for
  // infra REVISES only PROJ-1, which is still in flight: nothing can be requeued.
  const { result, labels, logs } = await run('K-6 · every revised task is still in flight: the halt says still running, not "requeued nothing"', [T('PROJ-1'), IN('PROJ-2')], (label, p) => {
    if (label === 'impl:PROJ-1') return HANG()
    if (label === 'impl:PROJ-2') return { status: 'BLOCKED', summary: 'nope' }
    if (label.startsWith('replan#')) return { decision: 'REVISE', cause: 'code', reason: 'redo PROJ-1', learnings: [], tasks: [T('PROJ-1')] }
    return happy(label, p)
  }, { args: { ...QUIET, ...FAST, repos: [API, INFRA] } })
  ok(logs.some((l) => /replan #1: PROJ-1 is still running past its hard limit — not requeued/.test(l)), 'PROJ-1 is not requeued')
  eq((result && result.halt && result.halt.kind) || null, 'wedged', 'halt kind: wedged')
  ok(/^still running: impl:PROJ-1 in api passed the 0\.005-min hard limit and has not returned; it may still commit — let it finish/.test((result && result.halt && result.halt.reason) || ''), `the halt names the writer still running (got ${JSON.stringify(result && result.halt && result.halt.reason)})`)
  eq(labels.filter((l) => l === 'impl:PROJ-1').length, 1, 'impl:PROJ-1 dispatched once')
}

// ══════════════ K-7 · issues a prefetch claims are handed back when the run halts before it returns ══════════════
{
  // Claims on. PROJ-2 waits on PROJ-1 and is prefetched (and claimed by that hydration) while PROJ-1
  // runs; the prefetch never returns. PROJ-1 is BLOCKED with no replan budget: the run halts.
  const { result, labels, prompt } = await run('K-7 · a prefetch still running at the halt: its issues are in the claim release', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], (label, p) => {
    if (label === 'impl:PROJ-1') return later(50, { status: 'BLOCKED', summary: 'no' })
    if (label === 'release-claims') return { released: ['PROJ-1', 'PROJ-2'] }
    return happy(label, p)
  }, { args: { ...QUIET, maxReplans: 0, claim: { identity: 'grimoire-bot' } }, hydrate: (label) => (label === 'hydrate:p1' ? HANG() : undefined) })
  ok(/- PROJ-2 /.test(prompt('hydrate:p1')) && /CLAIM these issues/.test(prompt('hydrate:p1')), 'PROJ-2 was prefetched by a claiming hydration')
  ok(/^exhausted replan budget/.test((result && result.halt && result.halt.reason) || ''), 'the run halted')
  ok(labels.includes('release-claims') && /- PROJ-2 \(api\)/.test(prompt('release-claims')), 'PROJ-2 is handed back with the release')
  ok(/- PROJ-1 \(api\)/.test(prompt('release-claims')), 'so is PROJ-1')
}

// ══════════════ K-8 · a repo with a failed task is not gated before that failure is decided ══════════════
{
  // One repo, the 0.9.0 defaults (incremental delivery, environment checks). PROJ-1 lands, PROJ-2 fails
  // and nothing depends on it: the project looks drained, but api still has a failure to replan.
  const DELIVERY = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
  const failing = (replan) => {
    let tries = 0
    return (label, p) => {
      if (label === 'impl:PROJ-2') return tries++ === 0 ? { status: 'BLOCKED', summary: 'stuck' } : { ...IMPL_OK, commits: ['bbbbbbb'], startSha: 'aaaaaaa', headSha: 'bbbbbbb' }
      if (label.startsWith('replan#')) return replan
      return happy(label, p)
    }
  }
  const a = await run('K-8a · PROJ-2 failed with no dependents: the environment check, then the replan, then the gate', [T('PROJ-1'), T('PROJ-2')],
    failing({ decision: 'REVISE', cause: 'code', reason: 'retry PROJ-2', learnings: [], tasks: [T('PROJ-2')] }), { args: DELIVERY })
  const at = (l) => a.labels.indexOf(l)
  ok(at('replan#1') > 0 && at('gate:api') > at('replan#1'), `no gate before replan#1 (gate:api at ${at('gate:api')}, replan#1 at ${at('replan#1')})`)
  ok(a.labels.some((l, i) => l.startsWith('env:') && i < at('replan#1')), 'the environment check ran before the replan')
  eq(a.labels.filter((l) => l === 'gate:api').length, 1, 'gate:api once, after PROJ-2 landed')
  ok(a.result && a.result.done.length === 2 && !a.result.halt, 'both landed, no halt')

  const b = await run('K-8b · … and the replan HALTs: api is never gated, its PR stays a draft, the halt ship comments', [T('PROJ-1'), T('PROJ-2')],
    failing({ decision: 'HALT', cause: 'code', reason: 'PROJ-2 needs a product decision', learnings: [] }), { args: DELIVERY })
  eq(b.labels.filter((l) => l.startsWith('gate:')), [], 'no gate: dispatch at all')
  eq((b.result && b.result.ungatedRepos) || null, ['api'], 'api is reported ungated')
  eq((b.result && b.result.draftPrs) || null, { api: 'https://github.com/x/y/pull/7' }, 'its PR is still a draft')
  ok(b.labels.includes('ship:api#halt') && (b.result && b.result.halt && b.result.halt.reason) === 'PROJ-2 needs a product decision', "the run halts with the replanner's reason; the halt ship ran for api")

  const c = await run('K-8c · … and the replan budget is spent (maxReplans 0): api is never gated, the run says why', [T('PROJ-1'), T('PROJ-2')],
    failing(null), { args: { ...DELIVERY, maxReplans: 0 } })
  eq(c.labels.filter((l) => l.startsWith('gate:') || l.startsWith('replan')), [], 'no replan, no gate')
  ok(/^exhausted replan budget \(0\) — PROJ-2 \(api\) BLOCKED did not land; api not gated$/.test((c.result && c.result.halt && c.result.halt.reason) || ''), `halt: exhausted budget, api not gated (got ${JSON.stringify(c.result && c.result.halt)})`)
  ok(c.labels.includes('ship:api#halt'), 'the halt ship ran for api')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
