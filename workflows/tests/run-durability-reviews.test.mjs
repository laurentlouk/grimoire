// ════════════════════════════════════════════════════════════════════════════
//  Run durability · reviewers in parallel, each in its own worktree (0.9.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-reviews.test.mjs
//
//  Grounded in a real unattended run (grimoire 0.8.0, ten slices in a strict chain, about
//  29 hours, zero PRs) whose journal showed every task paying the same chain strictly in
//  sequence: precheck (5–13 min), then spec review (8–36 min), then quality review (8–36 min).
//  Reviewers ran their commands in the shared product checkout, so no two could run at once —
//  two concurrent builds empty each other's output directory — and of the run's 32 reviews,
//  none failed. So:
//    • SPEC ∥ QUALITY ({reviewParallel:'stages'}, the default) — after the precheck, round 0 of
//      both stages judges the same head at once. A spec fix that moves the head makes the
//      quality verdict stale: it is journaled `discarded` and quality re-runs on the fixed head
//      as `<persona>:<id>~h1`
//    • PRECHECK ∥ SPEC ∥ QUALITY ({reviewParallel:'all'}) — opt-in; a precheck FAIL discards both
//      rounds, and the stages run in order once the precheck passes
//    • ONE WORKTREE PER REVIEWER — every review, verify, guard and sweep prompt carries a
//      "Running commands" block: a detached worktree at the reviewed head, named after the
//      dispatch, with the repo's laneSetup. The precheck (git reads only) gets none
//    • {reviewParallel:'off'} keeps the 0.8 order
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget);
//  every scenario asserts the dispatches the engine actually made.
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const deferred = () => { let resolve; const promise = new Promise((r) => (resolve = r)); return { promise, resolve } }
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
// concurrency probe: each listed label waits until ALL have been dispatched (or a 300 ms escape)
const barrier = (names) => { const seen = new Set(), d = deferred(); return (label) => { seen.add(label); if (names.every((n) => seen.has(n))) d.resolve('ALL'); return Promise.race([d.promise, tick(300).then(() => 'TIMEOUT')]) } }
const unb64 = (s) => Buffer.from(s.replace(/\s+/g, ''), 'base64').toString('utf8')

const SETUP = 'ln -sfn "$(cd repositories/api && pwd)/node_modules" <lane>/node_modules'
const APP = { name: 'app', path: 'repositories/app', agent: 'web-engineer', tags: ['web'], gate: null } // quality core: break-it
const API = { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null, laneSetup: SETUP } // quality core: data-integrity + break-it
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700' }
const QUIET = { verifyFindings: false, telemetry: { enabled: false } } // the precheck stays ON: it is part of the order under test

const TASK = { id: 'PROJ-1', ticket: 'PROJ-1', repo: 'app', agent: 'web-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: 'Build it', deferred: false, branch: 'feat/x', files: ['src/a.ts — add a'] }
const API_TASK = { ...TASK, repo: 'api', agent: 'backend-engineer' }
const IMPL_OK = { status: 'DONE', summary: 'Built it', commits: ['aaaaaaa'], baseSha: '0000000', startSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const FIX_OK = { status: 'DONE', summary: 'fixed', commits: ['bbbbbbb'], headSha: 'bbbbbbb', filesChanged: ['src/a.ts'] }
const FIX_NOOP = { status: 'DONE', summary: 'nothing to change', commits: [], headSha: 'aaaaaaa' }
const PC_PASS = { verdict: 'PASS', problems: [], summary: 'reviewable' }
const PC_FAIL = { verdict: 'FAIL', problems: [{ check: 'stub', file: 'src/a.ts', line: 1, issue: 'a stub is left in' }], summary: 'stub' }
const GATE_OK = { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
const CRY_OK = { reports: ['r'], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], summary: 'nothing' }
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const MAJOR = V('FAIL', [{ severity: 'major', file: 'src/a.ts', line: 3, issue: 'the empty case is not handled' }])
const base = (label) => {
  if (label.startsWith('impl:')) return IMPL_OK
  if (label.startsWith('fix:')) return FIX_OK
  if (label.startsWith('precheck:')) return PC_PASS
  if (label.startsWith('gate:')) return GATE_OK
  if (label.startsWith('guard:')) return { decision: 'PASS', reason: 'every finding addressed, contained' }
  if (label.startsWith('verify:')) return { results: [{ index: 1, verdict: 'CONFIRMED' }] }
  return V('PASS')
}
const isReview = (l) => /^(spec-hawk|break-it|data-integrity):PROJ-/.test(l)

const indexOf = (tasks) => ({
  slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })) }],
  hookProblems: [],
  toolLatencySec: 2,
})

// A faithful journal writer: takes the events out of the script's first heredoc (verbatim JSON
// lines, or base64 if the payload is encoded) and reports the counts the script would print.
function journalWriter(prompt, sink) {
  const docs = [...prompt.matchAll(/<<'([A-Z_]+)'\n([\s\S]*?)\n\1(?=\n|$)/g)].map((m) => m[2])
  const text = (d) => (/^\s*\{/.test(d) ? d : unb64(d)).replace(/\n$/, '')
  const lines = docs.length ? text(docs[0]).split('\n') : []
  for (const l of lines) { try { const e = JSON.parse(l); if (e && e.type) sink.push(e) } catch {} }
  return { runDir: '.grimoire/runs/run-p6', lines: lines.length, bytes: Buffer.byteLength(lines.join('\n') + '\n', 'utf8') }
}

async function run(scenario, tasks, responder, { args = {}, repos = [APP] } = {}) {
  const calls = []
  const events = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)) }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return CRY_OK
    if (label.startsWith('journal#')) return journalWriter(prompt, events)
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, repos, execute: true, ...QUIET, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  const labels = calls.map((c) => c.label)
  return { result, calls, logs, events, labels, at: (l) => labels.indexOf(l), prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}

// ══════════════ P-1 · spec and quality round 0 are in flight at the same time ══════════════
{
  const probe = barrier(['spec-hawk:PROJ-1', 'break-it:PROJ-1'])
  const seen = {}
  const { result } = await run('P-1a · default (stages): spec-hawk and break-it are both dispatched before either resolves', [TASK], async (label) => {
    if (label === 'spec-hawk:PROJ-1' || label === 'break-it:PROJ-1') { seen[label] = await probe(label); return V('PASS') }
    return base(label)
  })
  eq(seen, { 'spec-hawk:PROJ-1': 'ALL', 'break-it:PROJ-1': 'ALL' }, 'neither reviewer saw the barrier time out')
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task landed')
}
{
  const probe = barrier(['spec-hawk:PROJ-1', 'break-it:PROJ-1'])
  const seen = {}
  const { labels } = await run("P-1b · {reviewParallel:'off'}: the same probe times out — quality waits for spec", [TASK], async (label) => {
    if (label === 'spec-hawk:PROJ-1' || label === 'break-it:PROJ-1') { seen[label] = await probe(label); return V('PASS') }
    return base(label)
  }, { args: { reviewParallel: 'off' } })
  eq(seen['spec-hawk:PROJ-1'], 'TIMEOUT', 'spec-hawk resolved before break-it was dispatched')
  eq(labels.filter(isReview), ['spec-hawk:PROJ-1', 'break-it:PROJ-1'], 'spec, then quality')
}
{
  const probe = barrier(['spec-hawk:PROJ-1', 'data-integrity:PROJ-1', 'break-it:PROJ-1'])
  const seen = {}
  await run('P-1c · a two-lens quality core joins the same round', [API_TASK], async (label) => {
    if (isReview(label)) { seen[label] = await probe(label); return V('PASS') }
    return base(label)
  }, { repos: [API] })
  ok(Object.keys(seen).length === 3 && Object.values(seen).every((v) => v === 'ALL'), 'spec-hawk, data-integrity and break-it were all in flight together')
}

// ══════════════ P-2 · 'stages' keeps the precheck first; 'all' runs the panel next to it ══════════════
{
  let atPrecheck = null
  const { labels, at, logs } = await run('P-2a · stages: the precheck resolves before any reviewer is dispatched', [TASK], async (label, prompt, opts, calls) => {
    if (label.startsWith('precheck:')) { await tick(30); atPrecheck = calls.map((c) => c.label).filter(isReview); return PC_PASS }
    return base(label)
  })
  eq(atPrecheck, [], 'no reviewer was dispatched while the precheck ran')
  ok(at('precheck:PROJ-1') >= 0 && at('precheck:PROJ-1') < at('spec-hawk:PROJ-1') && at('precheck:PROJ-1') < at('break-it:PROJ-1'), 'precheck, then spec-hawk and break-it')
  ok(logs.some((l) => /PROJ-1: spec ∥ quality review on aaaaaaa/.test(l)), 'the parallel round is logged with its head')
  eq(labels.filter(isReview), ['spec-hawk:PROJ-1', 'break-it:PROJ-1'], 'one round each, nothing re-run')
}
{
  let atPrecheck = null
  const { result, labels } = await run("P-2b · {reviewParallel:'all'}: both reviewers run next to the precheck, and a PASS keeps their verdicts", [TASK], async (label, prompt, opts, calls) => {
    if (label.startsWith('precheck:')) { await tick(30); atPrecheck = calls.map((c) => c.label).filter(isReview); return PC_PASS }
    return base(label)
  }, { args: { reviewParallel: 'all' } })
  eq(atPrecheck, ['spec-hawk:PROJ-1', 'break-it:PROJ-1'], 'both reviewers were in flight while the precheck ran')
  eq(labels.filter(isReview), ['spec-hawk:PROJ-1', 'break-it:PROJ-1'], 'their round-0 verdicts counted: no reviewer re-run')
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task landed')
}

// ══════════════ P-3 · a spec fix that moves the head re-runs quality on the fixed head ══════════════
{
  const { result, labels, at, prompt, logs, events } = await run('P-3a · spec FAIL, quality PASS, the fix moves the head → break-it:PROJ-1~h1', [TASK], (label) => {
    if (label === 'spec-hawk:PROJ-1') return MAJOR
    return base(label)
  }, { args: { runId: 'run-p3', telemetry: { flushEvery: 500 } } })
  ok(at('fix:PROJ-1:spec#1') > 0 && at('break-it:PROJ-1~h1') > at('fix:PROJ-1:spec#1'), 'a fresh quality round after the spec fix')
  eq(labels.filter((l) => l.startsWith('break-it:')), ['break-it:PROJ-1', 'break-it:PROJ-1~h1'], 'exactly one re-run, with a unique label')
  ok(/worktree add --detach \.worktrees\/review-app--proj-1-break-it-r0-h1 bbbbbbb/.test(prompt('break-it:PROJ-1~h1')), 'it judges the fixed head, in a worktree of its own')
  ok(/diff 0000000\.\.bbbbbbb/.test(prompt('break-it:PROJ-1~h1')), "and the whole task's range up to it")
  ok(logs.some((l) => /a spec fix moved the head aaaaaaa → bbbbbbb — the quality round-0 verdict is stale/.test(l)), 'the discard is logged with both heads')
  const q = events.filter((e) => e.type === 'review' && e.task === 'PROJ-1' && e.stage === 'quality')
  eq(q.map((e) => [e.round, e.verdict, !!e.discarded]), [[0, 'PASS', true], [0, 'PASS', false]], 'the stale verdict is journaled discarded, the fresh one counts')
  ok(/moved the head aaaaaaa → bbbbbbb/.test((q.find((e) => e.discarded) || {}).reason || ''), 'with the reason')
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task landed')
}
{
  const { result, labels } = await run('P-3b · the spec fix moves nothing → the quality round-0 verdict stands', [TASK], (label) => {
    if (label === 'spec-hawk:PROJ-1') return MAJOR
    if (label.startsWith('fix:')) return FIX_NOOP
    return base(label)
  })
  ok(labels.includes('fix:PROJ-1:spec#1'), 'the spec fix ran')
  eq(labels.filter((l) => l.startsWith('break-it:')), ['break-it:PROJ-1'], 'no second quality dispatch')
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task landed')
}
{
  const { labels } = await run('P-3c · no SHAs reported anywhere: after a spec fix the head is unknown, so quality re-runs', [TASK], (label) => {
    if (label.startsWith('impl:')) return { status: 'DONE', summary: 'Built it', filesChanged: ['src/a.ts'] }
    if (label.startsWith('fix:')) return { status: 'DONE', summary: 'fixed' }
    if (label === 'spec-hawk:PROJ-1') return MAJOR
    return base(label)
  })
  eq(labels.filter((l) => l.startsWith('break-it:')), ['break-it:PROJ-1', 'break-it:PROJ-1~h1'], 'an unknown head is never assumed unchanged')
}
{
  const { result, labels } = await run('P-3d · spec FAIL past its fix budget → SPEC_FAILED; the quality verdict is not used', [TASK], (label) => {
    if (label.startsWith('spec-hawk:')) return MAJOR
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return base(label)
  }, { args: { maxFixAttempts: 1 } })
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['PROJ-1', 'SPEC_FAILED']], 'SPEC_FAILED, as under the 0.8 order')
  eq(labels.filter((l) => l.startsWith('break-it:PROJ-1')), ['break-it:PROJ-1'], 'the quality stage never started')
}

// ══════════════ P-4 · spec PASS, quality FAIL → the 0.8 quality fix loop, same stats ══════════════
{
  const scenario = (label) => (label === 'break-it:PROJ-1' ? MAJOR : base(label))
  const par = await run('P-4a · stages: spec PASS + quality FAIL → fix, then the quality re-review', [TASK], scenario)
  eq(par.labels.filter((l) => isReview(l) || l.startsWith('fix:')), ['spec-hawk:PROJ-1', 'break-it:PROJ-1', 'fix:PROJ-1:quality#1', 'break-it:PROJ-1#1'], 'the quality stage consumed its round 0 and fixed as before')
  eq(par.result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task landed')
  const seq = await run("P-4b · {reviewParallel:'off'}: the same scenario", [TASK], scenario, { args: { reviewParallel: 'off' } })
  eq(par.result.reviewStats, seq.result.reviewStats, 'reviewStats are identical to the sequential order')
  eq([par.result.reviewStats.stages, par.result.reviewStats.passedFirstRound, par.result.reviewStats.fixDispatches], [3, 2, 1], 'spec, quality and terminal stages; spec and terminal passed first round; one fix')
}

// ══════════════ P-5 · every reviewer prompt names its own worktree; the precheck's does not ══════════════
{
  const { prompt, labels, calls } = await run('P-5 · review, verify, guard and sweep prompts carry a detached worktree at the reviewed head, with the laneSetup', [API_TASK], (label) => {
    if (label === 'data-integrity:PROJ-1') return MAJOR
    return base(label)
  }, { repos: [API], args: { verifyFindings: true } })
  const wt = (who) => `repositories/api/.worktrees/review-${who}`
  const has = (l, who, head) => {
    const p = prompt(l)
    return p.includes('## Running commands') &&
      p.includes(`git -C repositories/api worktree add --detach .worktrees/review-${who} ${head}`) &&
      p.includes(`ln -sfn "$(cd repositories/api && pwd)/node_modules" ${wt(who)}/node_modules`) &&
      p.includes(`(cd ${wt(who)} && <your command>)`) &&
      p.includes(`git -C repositories/api worktree remove --force .worktrees/review-${who}`)
  }
  ok(has('spec-hawk:PROJ-1', 'api--proj-1-spec-hawk-r0', 'aaaaaaa'), 'spec review: its worktree at the implementer head, laneSetup substituted')
  ok(has('data-integrity:PROJ-1', 'api--proj-1-data-integrity-r0', 'aaaaaaa') && has('break-it:PROJ-1', 'api--proj-1-break-it-r0', 'aaaaaaa'), 'each quality reviewer: a worktree of its own')
  ok(has('verify:PROJ-1:quality#0', 'api--proj-1-verify-quality-r0', 'aaaaaaa'), 'the verifier')
  ok(labels.includes('guard:PROJ-1#1') && has('guard:PROJ-1#1', 'api--proj-1-guard-r1', 'bbbbbbb'), 'the guard, at the fixed head')
  const sweep = calls.find((c) => c.label === 'reliability-sre:api:final')
  const branch = ((sweep && sweep.prompt.match(/diff --stat origin\/main\.\.\.(\S+)/)) || [])[1]
  ok(!!branch && has('reliability-sre:api:final', 'api--api-final-reliability-sre-r0', branch), `the terminal sweep, at the run branch head (${branch})`)
  const pc = prompt('precheck:PROJ-1')
  ok(pc && !/Running commands/.test(pc) && !/worktree add/.test(pc), 'the precheck prompt gets no worktree block')
  const dirs = calls.filter((c) => /## Running commands/.test(c.prompt)).map((c) => (c.prompt.match(/worktree add --detach (\S+)/) || [])[1])
  eq(dirs.length, new Set(dirs).size, `no two dispatches share a worktree (${dirs.length} checked)`)
}
{
  const { prompt } = await run('P-5b · a repo without laneSetup: no setup line', [TASK], base)
  const p = prompt('spec-hawk:PROJ-1')
  ok(/worktree add --detach \.worktrees\/review-app--proj-1-spec-hawk-r0 aaaaaaa/.test(p) && !/lane setup/.test(p), 'the worktree block, without a setup line')
}

// ══════════════ P-6 · 'all' with a precheck FAIL: the panel's verdicts are discarded ══════════════
{
  let qualityDuringSpec = null
  const { result, labels, at, events, logs } = await run("P-6 · {reviewParallel:'all'} + precheck FAIL → round 0 discarded, then spec and quality in order", [TASK], (label, prompt, opts, calls) => {
    if (label === 'precheck:PROJ-1') return PC_FAIL
    if (label === 'spec-hawk:PROJ-1~h1') { qualityDuringSpec = calls.some((c) => c.label.startsWith('break-it:PROJ-1~h1')); return V('PASS') }
    return base(label)
  }, { args: { reviewParallel: 'all', runId: 'run-p6', telemetry: { flushEvery: 500 } } })
  ok(at('spec-hawk:PROJ-1') >= 0 && at('break-it:PROJ-1') >= 0 && at('spec-hawk:PROJ-1') < at('fix:PROJ-1:precheck#1'), 'round 0 ran next to the precheck')
  ok(at('spec-hawk:PROJ-1~h1') > at('precheck:PROJ-1#1') && at('break-it:PROJ-1~h1') > at('spec-hawk:PROJ-1~h1'), 'after the precheck fix: spec, then quality, under fresh labels')
  eq(qualityDuringSpec, false, 'quality was not dispatched while spec ran (the stages fell back to the 0.8 order)')
  const r0 = events.filter((e) => e.type === 'review' && e.task === 'PROJ-1')
  eq(r0.map((e) => [e.stage, e.round, !!e.discarded]).sort(), [['quality', 0, false], ['quality', 0, true], ['spec', 0, false], ['spec', 0, true]], 'one discarded and one counted round 0 per stage')
  ok(r0.filter((e) => e.discarded).every((e) => e.reason === 'the precheck failed'), 'the discards name the precheck')
  ok(logs.some((l) => /PROJ-1: the precheck failed — the spec and quality round 0 dispatched next to it is discarded/.test(l)), 'and are logged')
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task landed')
}
{
  const { result, labels } = await run("P-6b · {reviewParallel:'all'} + an exhausted precheck → PRECHECK_FAILED, no reviewer re-run", [TASK], (label) => {
    if (label.startsWith('precheck:')) return PC_FAIL
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return base(label)
  }, { args: { reviewParallel: 'all' } })
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['PROJ-1', 'PRECHECK_FAILED']], 'PRECHECK_FAILED, as before')
  eq(labels.filter(isReview), ['spec-hawk:PROJ-1', 'break-it:PROJ-1'], 'only the round dispatched next to the first precheck')
}

// ══════════════ P-7 · the 0.8 guarantees hold under the default ══════════════
{
  const { labels, at } = await run('P-7a · default: a precheck FAIL goes back to the implementer before any reviewer', [TASK], (label) => {
    if (label === 'precheck:PROJ-1') return PC_FAIL
    return base(label)
  })
  ok(at('fix:PROJ-1:precheck#1') > 0 && labels.slice(0, at('precheck:PROJ-1#1') + 1).every((l) => !isReview(l)), 'no reviewer before the precheck passed')
  eq(labels.filter(isReview), ['spec-hawk:PROJ-1', 'break-it:PROJ-1'], 'then one parallel round')
}
{
  const { result, labels } = await run('P-7b · default: an exhausted precheck pays no reviewer', [TASK], (label) => {
    if (label.startsWith('precheck:')) return PC_FAIL
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return base(label)
  })
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['PROJ-1', 'PRECHECK_FAILED']], 'PRECHECK_FAILED')
  ok(!labels.some(isReview), 'no reviewer was dispatched')
}
{
  const GATED = { ...API, gate: { run: 'make e2e' } }
  const { labels } = await run('P-7c · default, gated repo: the terminal sweep after the per-task quality core, the gate last', [API_TASK], base, { repos: [GATED] })
  const order = labels.filter((l) => !/^(parse-index|hydrate:|harness-context|ledger|crystallize|journal#|preflight:)/.test(l)).map((l) => l.replace(/:.*/, ''))
  ok(order.indexOf('reliability-sre') > order.lastIndexOf('break-it') && order.indexOf('reliability-sre') > order.lastIndexOf('spec-hawk'), 'the sweep ran after every per-task review')
  eq(order[order.length - 1], 'gate', 'the gate ran last')
}
{
  const { logs, labels } = await run('P-7d · an unknown reviewParallel value warns and keeps the default', [TASK], base, { args: { reviewParallel: 'yes' } })
  ok(logs.some((l) => /reviewParallel "yes" is not one of stages \| all \| off — using 'stages'/.test(l)), 'warned')
  ok(logs.some((l) => /spec ∥ quality review on/.test(l)) && labels.filter(isReview).length === 2, 'and ran the default')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
