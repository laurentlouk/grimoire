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

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
