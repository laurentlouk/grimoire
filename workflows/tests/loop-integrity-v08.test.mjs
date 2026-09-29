// ════════════════════════════════════════════════════════════════════════════
//  Loop-integrity regressions (0.8.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/loop-integrity-v08.test.mjs
//
//  Grounded in a real unattended run whose journal showed each of these defects:
//    • DIRECT TASKS OFF THE RUN BRANCH — a lone task committed on its tracker branch, so it
//      "landed" without ever reaching the run branch its dependents and the gate build on
//    • PRECHECK FALSE-POSITIVE LOOP — an integration task's range started at its first commit,
//      so the merged lane's older commits dragged other lanes' files into its "footprint"; the
//      run spent six prechecks and three replans on correct code
//    • UNRESOLVABLE AGENT TYPES — a bare plugin agent name is "not found", every dispatch of it
//      dies, and the loop used to find out one task at a time; a preflight refuses up front
//    • DEAD REVIEWERS READ AS FAILED CODE — when every reviewer of a stage returned nothing the
//      stage settled SPEC_FAILED and bought a replan; it is a harness failure: retry, then halt
//    • ESCALATION ON HARNESS FAILURES — every replanned task was forced onto opus, even when
//      its failure was a dead agent or a footprint false positive a stronger model cannot fix
//    • COMPRESSED OUTPUT TRUSTED — an output-compression hook can blank or garble a result;
//      implement and gate prompts now say how to re-run a command raw before concluding
//    • NO STATUS FOR "DONE, GATE PENDING" — gated-repo implementers reported DONE_WITH_CONCERNS
//      with no concern; DONE_PENDING_GATE is landed-equivalent everywhere DONE is
//    • PRE-EXISTING FAILURES BLAMED ON THE CHANGE — implementers "fixed" (or stalled on) a red
//      check that was already red on the base; the implement brief says how to tell
//
//  Same stubbed runtime as harness-v06.test.mjs (agent / parallel / log / phase / args /
//  budget); every scenario asserts the dispatches the engine actually made.
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const REPOS = [
  { name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: null },
  { name: 'infra', agent: 'infra-engineer', tags: ['infra'], gate: null },
]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-600', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }

const indexOf = (tasks) => ({
  slices: [...new Set(tasks.map((t) => t.slice ?? 1))].sort((a, b) => a - b).map((s) => ({
    slice: s,
    sliceLabel: 'v',
    issues: tasks.filter((t) => (t.slice ?? 1) === s).map((t) => ({ id: t.id, title: 't', repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })),
  })),
  hookProblems: [],
})

async function run(scenario, tasks, responder, { extraArgs = {} } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map((t) => ({ ...t })) }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return { reports: [], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], prUrl: '', summary: '' }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...extraArgs },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  return { result, calls, logs, labels: calls.map((c) => c.label), prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}

const T = (id, extra = {}) => ({ id, ticket: id, repo: 'api', agent: 'backend-engineer', model: 'sonnet', slice: 1, sliceLabel: 'v', order: 1, taskText: `Build ${id}`, deferred: false, files: [`src/${id}.ts — add it`], ...extra })
const PASSV = { verdict: 'PASS', findings: [], summary: 'ok' }
const impl = (sha, extra = {}) => ({ status: 'DONE', summary: 's', commits: [sha], baseSha: '0000000', headSha: sha, filesChanged: [], ...extra })

// ══════ 1 · a direct task always works ON the run branch ══════
// Hydration fills `branch` from the tracker's per-issue branch name. Two sequential direct
// tasks with distinct tracker branches must both commit on the ONE run branch (named after the
// first); a direct task on its own branch "lands" but is never integrated.
{
  const A = T('PROJ-1', { branch: 'feat/proj-1' })
  const B = T('PROJ-2', { branch: 'feat/proj-2', dependsOn: ['PROJ-1'] })
  const { result, labels, prompt } = await run('1 · sequential direct tasks share the run branch; precheck checks ancestry', [A, B], (label) => {
    if (label === 'impl:PROJ-1') return impl('aaaaaaa')
    if (label === 'impl:PROJ-2') return impl('bbbbbbb', { startSha: 'aaaaaaa' })
    if (label.startsWith('precheck:')) return { verdict: 'PASS', problems: [] }
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  eq(labels.filter((l) => l.startsWith('impl:')), ['impl:PROJ-1', 'impl:PROJ-2'], 'both tasks dispatched, one after the other')
  ok(/branch feat\/proj-1\b/.test(prompt('impl:PROJ-2')) && !/feat\/proj-2/.test(prompt('impl:PROJ-2')), 'the second implementer is told the run branch, never its tracker branch')
  ok(/RUN BRANCH `feat\/proj-1`/.test(prompt('impl:PROJ-2')), 'and told to commit on it (check it out, never start another branch)')
  ok(/merge-base --is-ancestor bbbbbbb feat\/proj-1/.test(prompt('precheck:PROJ-2')), "the precheck verifies the direct task's head is on the run branch")
  ok(!/is-ancestor/.test(prompt('spec-hawk:PROJ-2')), 'reviewers are not asked the ancestry question')
  eq(result.done.map((d) => [d.id, d.runBranch]), [['PROJ-1', 'feat/proj-1'], ['PROJ-2', 'feat/proj-1']], 'both land on the one run branch')
}

// ══════ 2 · the review range starts where the implementer STARTED ══════
{
  let spec = 0
  const { prompt } = await run('2a · startSha..headSha is the range; a fix never moves its origin', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return impl('bbbbbbb', { commits: ['aaaaaaa', 'bbbbbbb'], startSha: 'ccccccc' })
    if (label === 'fix:PROJ-1:spec#1') return impl('ddddddd', { commits: ['ddddddd'], startSha: 'bbbbbbb' })
    if (label.startsWith('precheck:')) return { verdict: 'PASS', problems: [] }
    if (label.startsWith('spec-hawk:')) return spec++ === 0 ? { verdict: 'FAIL', findings: [{ severity: 'major', file: 'src/a.ts', line: 1, issue: 'x' }], summary: 'f' } : PASSV
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  ok(/diff ccccccc\.\.bbbbbbb /.test(prompt('precheck:PROJ-1')) && !/aaaaaaa\^/.test(prompt('precheck:PROJ-1')), 'the precheck judges startSha..headSha, not firstSha^')
  ok(/diff ccccccc\.\.bbbbbbb /.test(prompt('spec-hawk:PROJ-1')), 'so does the panel')
  ok(/diff ccccccc\.\.ddddddd /.test(prompt('spec-hawk:PROJ-1#1')), "the re-review keeps the task's origin and advances only the head")
}
{
  const { prompt } = await run('2b · without startSha the range falls back to firstSha^', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return impl('bbbbbbb', { commits: ['aaaaaaa', 'bbbbbbb'] })
    return PASSV
  }, { extraArgs: QUIET })
  ok(/diff aaaaaaa\^\.\.bbbbbbb /.test(prompt('spec-hawk:PROJ-1')), 'aaaaaaa^..bbbbbbb')
}

// ══════ 3 · a repeated footprint-only precheck FAIL with no new commit is advisory ══════
// The precheck is an optimisation, not a gate: when the same files are flagged for footprint
// twice and the fix added nothing, another fix (or a replan) cannot change the answer.
const FOOTPRINT = { verdict: 'FAIL', problems: [{ check: 'footprint', file: 'lib/projection.rs', issue: 'changed but not declared' }], summary: 'f' }
for (const maxPrecheckFixes of [1, 3]) {
  const { result, labels } = await run(`3${maxPrecheckFixes === 1 ? 'a' : 'b'} · identical footprint FAIL twice, no new commit → advisory, panel runs (maxPrecheckFixes ${maxPrecheckFixes})`, [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return impl('aaaaaaa', { startSha: '0000000' })
    if (label.startsWith('fix:PROJ-1:precheck')) return impl('aaaaaaa', { commits: [], summary: 'nothing to change: the file is inherited' })
    if (label.startsWith('precheck:')) return FOOTPRINT
    return PASSV
  }, { extraArgs: { maxPrecheckFixes, verifyFindings: false, telemetry: { enabled: false } } })
  eq(labels.filter((l) => l.startsWith('precheck:') || l.startsWith('fix:')), ['precheck:PROJ-1', 'fix:PROJ-1:precheck#1', 'precheck:PROJ-1#1'], 'one fix, then the repeat is demoted — no further fix')
  ok(labels.includes('spec-hawk:PROJ-1') && !labels.some((l) => l.startsWith('replan')), 'the panel runs; no replan')
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'the task lands, never PRECHECK_FAILED')
  eq(result.advisoryNotes.filter((n) => n.persona === 'Precheck'), [{ task: 'PROJ-1', repo: 'api', severity: 'minor', persona: 'Precheck', where: 'lib/projection.rs:?', issue: 'footprint (advisory: flagged twice with no new commit in between): changed but not declared' }], 'the footprint problem is reported as an advisory note')
  eq({ failed: result.precheckStats.failed, advisory: result.precheckStats.advisory }, { failed: 1, advisory: 1 }, 'precheckStats count one catch and one demotion')
}
{
  const ANCESTRY = { verdict: 'FAIL', problems: [{ check: 'ancestry', file: '?', issue: 'head not on the run branch' }] }
  const { result } = await run('3c · a repeated ANCESTRY failure is never demoted', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return impl('aaaaaaa')
    if (label.startsWith('fix:')) return impl('aaaaaaa', { commits: [] })
    if (label.startsWith('precheck:')) return ANCESTRY
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['PROJ-1', 'PRECHECK_FAILED']], 'PRECHECK_FAILED')
}
{
  let n = 0
  const { result } = await run('3d · a footprint FAIL after a fix that DID commit still counts', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return impl('aaaaaaa')
    if (label.startsWith('fix:')) return impl('bbbbbbb')
    if (label.startsWith('precheck:')) return n++ < 2 ? FOOTPRINT : { verdict: 'PASS', problems: [] }
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['PROJ-1', 'PRECHECK_FAILED']], 'PRECHECK_FAILED (the fix changed the tree)')
}

// ══════ 4 · the startup agent preflight ══════
{
  const { result, calls, labels } = await run('4a · one agent type that does not resolve → the run refuses, nothing is built', [T('PROJ-1')], (label, prompt, opts) => {
    if (label.startsWith('preflight:')) return opts.agentType === 'grimoire:security-scout' ? null : { ok: true }
    if (label.startsWith('impl:')) return impl('aaaaaaa')
    return PASSV
  }, { extraArgs: { ...QUIET, specialists: [{ agent: 'migration-engineer', repos: ['api'] }], finalCheck: { repos: ['api'], prompt: 'check', agentType: 'contract-auditor' } } })
  const pre = calls.filter((c) => c.label.startsWith('preflight:'))
  eq(pre.map((c) => c.opts.agentType).sort(), ['backend-engineer', 'contract-auditor', 'grimoire:codebase-scout', 'grimoire:contract-checker', 'grimoire:migration-engineer', 'grimoire:perf-scout', 'grimoire:reviewer', 'grimoire:security-scout'], 'every agent type the run can use is probed once (owner of each repo in the project, specialists, reviewer, scouts, finalCheck)')
  ok(pre.length > 0 && pre.every((c) => c.opts.model === 'haiku' && c.opts.effort === 'low' && c.opts.schema && /reply/i.test(c.prompt)), 'each probe is a trivial schema-bound reply on haiku')
  eq({ error: result.error, problems: result.problems }, { error: 'agents_unavailable', problems: ['grimoire:security-scout'] }, 'refused with the unresolvable type named')
  ok(/agentNamespace/.test(result.note) && /preflight:false/.test(result.note), 'the note names the likely cause and the escape hatch')
  ok(!labels.some((l) => l.startsWith('hydrate:') || l.startsWith('impl:')), 'no hydration, no implementer')
}
{
  const { result, labels } = await run('4b · every type answers → the run proceeds; {preflight:false} skips the probe', [T('PROJ-1')], (label) => {
    if (label.startsWith('preflight:')) return { ok: true }
    if (label.startsWith('impl:')) return impl('aaaaaaa')
    return PASSV
  }, { extraArgs: QUIET })
  ok(labels.some((l) => l.startsWith('preflight:')) && result.done.length === 1, 'probed, then built')
  const off = await run('4c · preflight off', [T('PROJ-1')], (label) => (label.startsWith('impl:') ? impl('aaaaaaa') : PASSV), { extraArgs: { ...QUIET, preflight: false } })
  ok(!off.labels.some((l) => l.startsWith('preflight:')) && off.result.done.length === 1, 'no probe, still built')
  const prev = await run('4d · a preview never probes', [T('PROJ-1')], () => PASSV, { extraArgs: { execute: false } })
  ok(!prev.labels.some((l) => l.startsWith('preflight:')), 'preview: nothing probed')
}

// ══════ 5 · every reviewer of a stage dead → retry once, then halt; never a replan ══════
{
  const A = T('PROJ-1')
  const B = T('PROJ-2', { dependsOn: ['PROJ-1'] })
  const { result, labels, logs } = await run('5a · all spec reviewers dead twice → halt "reviewers unavailable", no replan, code not failed', [A, B], (label) => {
    if (label.startsWith('impl:')) return impl('aaaaaaa')
    if (label.startsWith('spec-hawk:')) return null
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'should never be asked', learnings: [] }
    return PASSV
  }, { extraArgs: QUIET })
  eq(labels.filter((l) => l.startsWith('spec-hawk:')), ['spec-hawk:PROJ-1', 'spec-hawk:PROJ-1~r1'], 'the stage is retried exactly once')
  ok(!labels.some((l) => l.startsWith('replan')) && result.replans === 0, 'no replan is spent')
  ok(result.halt && /^reviewers unavailable/.test(result.halt.reason) && /grimoire:reviewer/.test(result.halt.reason), `the halt names the reviewers (got: ${result.halt && result.halt.reason})`)
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['PROJ-1', 'REVIEWERS_UNAVAILABLE']], 'the task is REVIEWERS_UNAVAILABLE, never SPEC_FAILED')
  eq(result.blocked.map((b) => b.id), ['PROJ-2'], 'its dependent never ran')
  ok(logs.some((m) => /retrying the round/.test(m)), 'the retry is logged')
}
{
  let n = 0
  const { result } = await run('5b · reviewers back on the retry → the stage proceeds', [T('PROJ-1')], (label) => {
    if (label.startsWith('impl:')) return impl('aaaaaaa')
    if (label.startsWith('spec-hawk:')) return n++ === 0 ? null : PASSV
    return PASSV
  }, { extraArgs: QUIET })
  eq(result.done.map((d) => [d.id, d.status]), [['PROJ-1', 'DONE']], 'landed')
  ok(!result.halt, 'no halt')
}
{
  const { result, labels } = await run('5c · all TERMINAL reviewers dead → halt, no replan, repo left ungated', [T('PROJ-1')], (label) => {
    if (label.startsWith('impl:')) return impl('aaaaaaa')
    if (label.startsWith('reliability-sre:') || label.startsWith('privacy:')) return null
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'should never be asked', learnings: [] }
    return PASSV
  }, { extraArgs: QUIET })
  ok(!labels.some((l) => l.startsWith('replan')) && result.halt && /^reviewers unavailable/.test(result.halt.reason), 'halted on the reviewers, no replan')
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['api:final', 'REVIEWERS_UNAVAILABLE']], 'the terminal slot is REVIEWERS_UNAVAILABLE')
  eq(result.ungatedRepos, ['api'], 'the repo is reported ungated')
}

// ══════ 6 · a replanned task escalates to opus only after a CODE failure ══════
{
  const cases = [
    { name: '6a · DIED (harness) → keeps the selector tier', first: () => null, want: 'haiku', why: /harness failure \(DIED\)/ },
    { name: '6b · PRECHECK_FAILED on ancestry (harness) → keeps the tier', first: () => impl('aaaaaaa'), precheck: { verdict: 'FAIL', problems: [{ check: 'ancestry', file: '?', issue: 'head not on the run branch' }] }, want: 'haiku', why: /harness failure \(PRECHECK_FAILED\)/ },
    { name: '6c · PRECHECK_FAILED on tests (code) → opus', first: () => impl('aaaaaaa'), precheck: { verdict: 'FAIL', problems: [{ check: 'tests', file: 'src/a.ts', issue: 'behaviour change with no test' }] }, want: 'opus', why: /code failure \(PRECHECK_FAILED\)/ },
    { name: '6d · BLOCKED (code) → opus', first: () => ({ status: 'BLOCKED', summary: 'the approach does not work' }), want: 'opus', why: /code failure \(BLOCKED\)/ },
  ]
  for (const c of cases) {
    let n = 0, pc = 0
    const CHEAP = T('PROJ-1', { model: 'haiku' })
    const { calls, logs, result } = await run(c.name, [CHEAP], (label) => {
      if (label.startsWith('impl:')) return n++ === 0 ? c.first() : impl('bbbbbbb')
      if (label.startsWith('fix:')) return impl('aaaaaaa', { commits: [] })
      if (label.startsWith('precheck:')) return c.precheck && pc++ < 2 ? c.precheck : { verdict: 'PASS', problems: [] }
      if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'again', learnings: [], tasks: [{ ...CHEAP, taskText: 'Build it again' }] }
      return PASSV
    }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false }, precheck: !!c.precheck } })
    eq(calls.filter((x) => x.label === 'impl:PROJ-1').map((x) => x.opts.model), ['haiku', c.want], `first attempt haiku, replanned attempt ${c.want}`)
    ok(logs.some((m) => /PROJ-1: replanned after a/.test(m) && c.why.test(m)), 'the routing reason names the failure kind')
    ok(result.done.length === 1 && result.routing.byModel[c.want] >= 1, 'the retry lands')
  }
}

// ══════ 7 · the raw-output escape in the implement and gate prompts ══════
{
  const GATED = [{ name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: { kind: 'command', run: 'make e2e' } }]
  const HOOK = { name: 'rtk hook claude', check: 'command -v rtk', raw: 'rtk proxy' }
  const responder = (label) => (label.startsWith('impl:') ? impl('aaaaaaa') : label.startsWith('gate:') ? { status: 'DONE', summary: 'shipped', prUrl: 'https://x/pr/1' } : PASSV)
  const RAW = "If a command's output is empty, garbled or contradicts its exit code, re-run it as `rtk proxy <cmd>` before drawing a conclusion."
  const GENERIC = "If a command's output is empty, garbled or contradicts its exit code, re-run it with its raw, unfiltered output (bypassing any output-compression hook) before drawing a conclusion."
  const on = await run('7a · requireHook.raw set → the exact re-run command', [T('PROJ-1')], responder, { extraArgs: { ...QUIET, repos: GATED, requireHook: HOOK } })
  ok(on.prompt('impl:PROJ-1').includes(RAW) && on.prompt('gate:api').includes(RAW), 'implement and gate prompts carry the raw re-run line')
  const off = await run('7b · no raw configured → the generic rule, no command', [T('PROJ-1')], responder, { extraArgs: { ...QUIET, repos: GATED } })
  ok(off.prompt('impl:PROJ-1').includes(GENERIC) && off.prompt('gate:api').includes(GENERIC), 'implement and gate prompts carry the generic line')
  ok(!/rtk proxy/.test(off.prompt('impl:PROJ-1')), 'and name no command')
}

// ══════ 8 · DONE_PENDING_GATE lands like DONE ══════
{
  const GATED = [{ name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: { kind: 'command', run: 'make e2e' } }, { name: 'infra', agent: 'infra-engineer', tags: ['infra'], gate: null }]
  const A = T('PROJ-1')
  const B = T('PROJ-2', { dependsOn: ['PROJ-1'] })
  const C = T('PROJ-3', { repo: 'infra', agent: 'infra-engineer', files: ['main.tf — x'] })
  const { result, labels, prompt } = await run('8a · a gated implementer returns DONE_PENDING_GATE → landed, dependents unblock, the gate ships', [A, B, C], (label) => {
    if (label.startsWith('impl:PROJ-3')) return impl('ccccccc')
    if (label.startsWith('impl:')) return impl('aaaaaaa', { status: 'DONE_PENDING_GATE' })
    if (label.startsWith('gate:')) return { status: 'DONE', summary: 'gate green, PR open', prUrl: 'https://x/pr/9' }
    return PASSV
  }, { extraArgs: { ...QUIET, repos: GATED } })
  ok(labels.includes('impl:PROJ-2'), 'the dependent was dispatched')
  eq(result.done.map((d) => [d.id, d.status]).sort(), [['PROJ-1', 'DONE_PENDING_GATE'], ['PROJ-2', 'DONE_PENDING_GATE'], ['PROJ-3', 'DONE']], 'all three land')
  eq(result.needsAttention, [], 'nothing needs attention')
  eq(result.prs.map((p) => p.pr), ['https://x/pr/9'], 'the gate ran and opened the PR')
  ok(/return \*\*DONE_PENDING_GATE\*\*/.test(prompt('impl:PROJ-1')), 'the gated implementer is told to return DONE_PENDING_GATE')
  ok(!/DONE_PENDING_GATE/.test(prompt('impl:PROJ-3')), 'an ungated implementer is not')
}
{
  const GATED = [{ name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: { kind: 'command', run: 'make e2e' } }]
  const { result } = await run('8b · a GATE dispatch that returns DONE_PENDING_GATE did not certify anything', [T('PROJ-1')], (label) => {
    if (label.startsWith('impl:')) return impl('aaaaaaa', { status: 'DONE_PENDING_GATE' })
    if (label.startsWith('gate:')) return { status: 'DONE_PENDING_GATE', summary: 'left it for later' }
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return PASSV
  }, { extraArgs: { ...QUIET, repos: GATED } })
  eq(result.needsAttention.map((r) => [r.id, r.status]), [['api:gate', 'GATE_FAILED']], 'GATE_FAILED')
}

// ══════ 9 · the implement brief: check a failure on the base before owning it ══════
{
  console.log('\n── 9 · the implement brief carries the pre-existing-failure rule (every build and fix round reads it)')
  const brief = readFileSync(`${DIR}/briefs/implement.md`, 'utf8')
  const rule = (/\*\*Pre-existing failures are not yours\.\*\*[\s\S]*?(?=\n- \*\*|\n\n)/.exec(brief) || [''])[0]
  ok(/run it on the base/.test(rule) && /throwaway worktree/.test(rule) && /baseSha/.test(rule), 'run the failing check on the base, in a throwaway worktree of baseSha')
  ok(/never `git stash`/.test(rule), 'never by stashing or checking out in the working tree')
  ok(/`concerns`/.test(rule) && /pre-existing/.test(rule) && /unrelated/.test(rule), 'report it as pre-existing in concerns; do not fix unrelated failures')
  const { prompt } = await run('9b · build and fix dispatches point at that brief', [T('PROJ-1')], (label) => (label.startsWith('impl:') ? impl('aaaaaaa') : PASSV), { extraArgs: QUIET })
  ok(prompt('impl:PROJ-1').includes('Read `workflows/briefs/implement.md`'), 'the implementer reads briefs/implement.md')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
