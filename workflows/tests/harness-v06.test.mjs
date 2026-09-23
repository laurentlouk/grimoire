// ════════════════════════════════════════════════════════════════════════════
//  Tests for the loop's newer rungs — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/harness-v06.test.mjs
//
//  Same stubbed runtime as workflow-gates.test.mjs (agent / parallel / log / phase / args /
//  budget), aimed at what the other suites switch off:
//    • PRECHECK — a structural FAIL goes back to the implementer before any reviewer is
//      paid; an exhausted precheck is PRECHECK_FAILED with no review; a dead one passes
//    • FINDING VERIFICATION — a gating finding REJECTED with evidence buys no fix; one
//      REJECTED without evidence still gates; a dead verifier keeps every finding
//    • THE SELECTOR — agent × model from hydration, validated against the roster (unknown
//      agent → owner), specialists only where enabled, escalation to opus from the
//      configured fix round, replanned tasks on opus
//    • SCOUT ROUTING by question shape (contract · security · perf · codebase)
//    • THE COST FUSE — maxOutputTokens halts cleanly as budget_exhausted
//    • CLAIMS — work someone else started is never dispatched; claims are made at
//      hydration and released for what did not land
//    • THE DECISION JOURNAL — chunked, idempotent writes with a line/byte receipt, run.json
//      checkpoint, and cross-session resume from it
//    • LEARNINGS BY RELEVANCE — hydration carries learnings for its own repos only
import { readFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

const REPOS = [
  { name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: null },
  { name: 'infra', agent: 'infra-engineer', tags: ['infra'], gate: null },
]
// Every newer rung is ON by default in the engine; each scenario states what it switches off.
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-600', repos: REPOS }

const indexOf = (tasks, extra = {}) => ({
  slices: [...new Set(tasks.map((t) => t.slice ?? 1))].sort((a, b) => a - b).map((s) => ({
    slice: s,
    sliceLabel: 'v',
    issues: tasks
      .filter((t) => (t.slice ?? 1) === s)
      .map((t) => ({ id: t.id, title: 't', repo: t.repo, state: t.state || 'todo', assignee: t.assignee || '', dependsOn: t.dependsOn || [] })),
  })),
  hookProblems: [],
  ...extra,
})

async function run(scenario, tasks, responder, { extraArgs = {}, spent = () => 0 } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map(({ state, assignee, ...t }) => t) }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...extraArgs },
    { total: null, spent, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  return { result, calls, logs, labels: calls.map((c) => c.label) }
}

const TASK = { id: 'PROJ-1', ticket: 'PROJ-1', repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: 'Build it', deferred: false, branch: 'feat/x', files: ['src/a.ts — add a'] }
const IMPL_OK = { status: 'DONE', summary: 's', commits: ['aaaaaaa'], baseSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const FIX_OK = { status: 'DONE', summary: 'fixed', commits: ['bbbbbbb'], headSha: 'bbbbbbb' }
const PASSV = { verdict: 'PASS', findings: [], summary: 'ok' }
const MAJOR = { verdict: 'FAIL', findings: [{ severity: 'major', file: 'src/a.ts', line: 3, issue: 'unhandled null' }], summary: 'fail' }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
// The learning dispatches that follow every execute run.
const learning = (label) => {
  if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
  if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
  if (label === 'crystallize') return { reports: [], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], prUrl: '', summary: '' }
  return undefined
}

// ── 1 · precheck ──
{
  let pcN = 0
  const { labels, result } = await run('P1 · a precheck FAIL goes back to the implementer BEFORE any reviewer', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('precheck:')) return pcN++ === 0 ? { verdict: 'FAIL', problems: [{ file: 'src/a.ts', line: 1, issue: 'no test added for a behaviour change' }], summary: 'x' } : { verdict: 'PASS', problems: [] }
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('fix:')) return FIX_OK
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  const firstReview = labels.findIndex((l) => l.startsWith('spec-hawk:'))
  const fix = labels.indexOf('fix:PROJ-1:precheck#1')
  ok(fix > 0 && firstReview > fix, 'the precheck fix is dispatched before the first reviewer')
  ok(labels.filter((l) => l.startsWith('precheck:')).length === 2, 'the precheck re-runs on the fixed range')
  ok(result.done.length === 1 && result.precheckStats.failed === 1 && result.precheckStats.fixDispatches === 1, 'the task lands and the stats count the catch')
}
{
  const { labels, result } = await run('P2 · an exhausted precheck is PRECHECK_FAILED and pays no reviewer', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('precheck:')) return { verdict: 'FAIL', problems: [{ file: 'src/a.ts', line: 0, issue: 'empty diff' }] }
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('fix:')) return FIX_OK
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop', learnings: [] }
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  ok(!labels.some((l) => l.startsWith('spec-hawk:') || l.startsWith('break-it:')), 'no reviewer was dispatched')
  ok(result.needsAttention.some((r) => r.id === 'PROJ-1' && r.status === 'PRECHECK_FAILED'), 'the task fails as PRECHECK_FAILED')
  const rp = labels.find((l) => l.startsWith('replan'))
  ok(!!rp, 'the failure reaches the replanner like any other')
}
{
  const { result, labels } = await run('P3 · a dead precheck passes through to the panel', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('precheck:')) return null
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: { verifyFindings: false, telemetry: { enabled: false } } })
  ok(labels.some((l) => l.startsWith('spec-hawk:')) && result.done.length === 1, 'the panel ran and the task landed')
}

// ── 2 · finding verification ──
{
  const { labels, result } = await run('V1 · a finding REJECTED with evidence buys no fix', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('spec-hawk:')) return MAJOR
    if (label.startsWith('verify:')) return { results: [{ index: 1, verdict: 'REJECTED', evidence: 'src/a.ts:2 guards null before line 3' }] }
    return PASSV
  }, { extraArgs: { precheck: false, telemetry: { enabled: false } } })
  ok(!labels.some((l) => l.startsWith('fix:')), 'no fix dispatch')
  ok(result.done.length === 1, 'the stage passed and the task landed')
  ok(result.overturnedFindings.length === 1 && /guards null/.test(result.overturnedFindings[0].evidence), 'the overturned finding is reported with its evidence')
}
{
  const { labels } = await run('V2 · REJECTED without evidence still gates', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('fix:')) return FIX_OK
    if (label === 'spec-hawk:PROJ-1') return MAJOR
    if (label.startsWith('verify:')) return { results: [{ index: 1, verdict: 'REJECTED', evidence: '' }] }
    return PASSV
  }, { extraArgs: { precheck: false, telemetry: { enabled: false } } })
  ok(labels.includes('fix:PROJ-1:spec#1'), 'the fix was dispatched')
}
{
  const { labels } = await run('V3 · a dead verifier keeps every finding', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('fix:')) return FIX_OK
    if (label === 'spec-hawk:PROJ-1') return MAJOR
    if (label.startsWith('verify:')) return null
    return PASSV
  }, { extraArgs: { precheck: false, telemetry: { enabled: false } } })
  ok(labels.includes('fix:PROJ-1:spec#1'), 'the fix was dispatched')
}

// ── 3 · the selector ──
{
  const SPEC = { ...TASK, agent: 'migration-engineer', model: 'sonnet', routeReason: 'adds a column + backfill' }
  const { calls, result } = await run('R1 · an enabled specialist is dispatched with the chosen tier', [SPEC], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: { ...QUIET, specialists: [{ agent: 'migration-engineer', repos: ['api'], use: 'schema and data migrations' }] } })
  const impl = calls.find((c) => c.label === 'impl:PROJ-1')
  ok(impl.opts.agentType === 'migration-engineer' && impl.opts.model === 'sonnet', 'agentType = the specialist, model = sonnet')
  const hyd = calls.find((c) => c.label.startsWith('hydrate:'))
  ok(/specialists: `migration-engineer` \(schema and data migrations\)/.test(hyd.prompt), 'hydration is shown the specialist for that repo')
  ok(result.routing.byAgent['migration-engineer'] === 1 && result.routing.fallbacks === 0, 'routing stats record the pick')
}
{
  const ROGUE = { ...TASK, agent: 'migration-engineer', model: 'haiku' }
  const { calls, result } = await run('R2 · a specialist NOT enabled for the repo falls back to the owner', [ROGUE], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: { ...QUIET, specialists: [{ agent: 'migration-engineer', repos: ['infra'] }] } })
  const impl = calls.find((c) => c.label === 'impl:PROJ-1')
  ok(impl.opts.agentType === 'backend-engineer', 'dispatched as the owner')
  ok(result.routing.fallbacks === 1, 'the fallback is counted')
}
{
  const CHEAP = { ...TASK, model: 'haiku' }
  let specN = 0
  const { calls, result } = await run('R3 · the implementer escalates to opus from the configured fix round', [CHEAP], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('fix:')) return FIX_OK
    if (label.startsWith('spec-hawk:')) return specN++ < 2 ? MAJOR : PASSV
    return PASSV
  }, { extraArgs: QUIET })
  const model = (l) => (calls.find((c) => c.label === l) || { opts: {} }).opts.model
  ok(model('impl:PROJ-1') === 'haiku' && model('fix:PROJ-1:spec#1') === 'haiku', 'the first build and first fix run on the chosen tier')
  ok(model('fix:PROJ-1:spec#2') === 'opus', 'the second fix round runs on opus')
  ok(result.routing.escalations === 1, 'one escalation is recorded')
}
{
  const UNSET = { ...TASK }
  delete UNSET.model
  const { calls } = await run('R4 · an unset tier is opus', [UNSET], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: QUIET })
  ok(calls.find((c) => c.label === 'impl:PROJ-1').opts.model === 'opus', 'opus')
}
{
  const CHEAP = { ...TASK, model: 'haiku' }
  let implN = 0
  const { calls } = await run('R5 · a replanned task is routed on opus', [CHEAP], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return implN++ === 0 ? { status: 'BLOCKED', summary: 'stuck' } : IMPL_OK
    if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'new approach', learnings: ['approach A fails on X'], tasks: [{ ...CHEAP, taskText: 'Build it differently' }] }
    return PASSV
  }, { extraArgs: QUIET })
  const impls = calls.filter((c) => c.label === 'impl:PROJ-1')
  ok(impls.length === 2 && impls[0].opts.model === 'haiku' && impls[1].opts.model === 'opus', 'first attempt haiku, replanned attempt opus')
}

// ── 4 · scout routing ──
{
  const asked = []
  const qs = ['Which proto field carries the id?', 'Is the admin role checked before this handler?', 'Is this query on the hot path, what is its latency?', 'Where is the retry helper?']
  let n = 0
  const { calls } = await run('S1 · NEEDS_CONTEXT goes to the scout the question is about', [TASK], (label, prompt, opts) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return n < qs.length ? { status: 'NEEDS_CONTEXT', summary: 'q', question: qs[n++] } : IMPL_OK
    if (label.startsWith('resolve:')) { asked.push(opts.agentType); return { answered: true, answer: 'x at a.ts:1' } }
    return PASSV
  }, { extraArgs: { ...QUIET, maxContextResolves: 4 } })
  ok(JSON.stringify(asked) === JSON.stringify(['contract-checker', 'security-scout', 'perf-scout', 'codebase-scout']), `contract · security · perf · codebase (got ${asked.join(', ')})`)
}

// ── 5 · the cost fuse ──
{
  let tok = 0
  const T2 = { ...TASK, id: 'PROJ-2', ticket: 'PROJ-2', dependsOn: ['PROJ-1'], files: ['src/b.ts'] }
  const { result, labels } = await run('B1 · maxOutputTokens stops dispatching and halts as budget_exhausted', [TASK, T2], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) { tok += 600; return IMPL_OK }
    return PASSV
  }, { extraArgs: { ...QUIET, maxOutputTokens: 500 }, spent: () => tok })
  ok(labels.includes('impl:PROJ-1') && !labels.includes('impl:PROJ-2'), 'the dependent was never dispatched')
  ok(result.halt && /^budget_exhausted/.test(result.halt.reason), 'halt reason is budget_exhausted')
  ok(result.done.length === 1, 'in-flight work still settled')
}
{
  let tok = 0
  const { result } = await run('B2 · a resumed run counts what earlier sessions spent', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: { ...QUIET, maxOutputTokens: 1000, resumeState: { outputTokensSpent: 5000 } }, spent: () => tok })
  ok(result.halt && /^budget_exhausted/.test(result.halt.reason) && result.done.length === 0, 'already over the cap → nothing dispatched')
}

// ── 6 · claims ──
{
  const MINE = { ...TASK, id: 'PROJ-3', ticket: 'PROJ-3', files: ['src/c.ts'] }
  const THEIRS = { ...TASK, id: 'PROJ-4', ticket: 'PROJ-4', state: 'started', assignee: 'alice', files: ['src/d.ts'] }
  const AFTER = { ...TASK, id: 'PROJ-5', ticket: 'PROJ-5', dependsOn: ['PROJ-4'], files: ['src/e.ts'] }
  const FAILS = { ...TASK, id: 'PROJ-6', ticket: 'PROJ-6', repo: 'infra', agent: 'infra-engineer', files: ['main.tf'] }
  const { result, calls, labels } = await run('C1 · claims: skip work someone else started, claim at hydration, release what did not land', [MINE, THEIRS, AFTER, FAILS], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label === 'impl:PROJ-6') return { status: 'BLOCKED', summary: 'needs a human' }
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'needs a human', learnings: [] }
    if (label === 'release-claims') return { released: ['PROJ-6'] }
    return PASSV
  }, { extraArgs: { ...QUIET, claim: { identity: 'grimoire-bot' } } })
  ok(!labels.includes('impl:PROJ-4') && !labels.includes('impl:PROJ-5'), "alice's issue and its dependent were never dispatched")
  ok(result.claimedElsewhere.length === 1 && result.claimedElsewhere[0].by === 'alice', 'reported under claimedElsewhere')
  ok(/Claims are ON/.test(calls.find((c) => c.label === 'parse-index').prompt), 'the index is asked for assignees')
  ok(calls.filter((c) => c.label.startsWith('hydrate:')).every((c) => /CLAIM these issues/.test(c.prompt) && /grimoire-bot/.test(c.prompt)), 'every hydration claims its issues for the run identity')
  const rel = calls.find((c) => c.label === 'release-claims')
  ok(!!rel && /PROJ-6/.test(rel.prompt) && !/PROJ-3/.test(rel.prompt), 'only the claimed issue that did not land is released')
  ok(JSON.stringify(result.claimsReleased) === '["PROJ-6"]', 'claimsReleased is reported')
}
{
  const { labels } = await run('C2 · claims are off by default', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: QUIET })
  ok(!labels.includes('release-claims'), 'no release dispatch')
}

{
  // PROJ-7 is in the project but blocked behind PROJ-8, so hydration never saw it; the replan re-enters it directly.
  const A = { ...TASK, id: 'PROJ-8', ticket: 'PROJ-8', files: ['src/h.ts'] }
  const B = { ...TASK, id: 'PROJ-7', ticket: 'PROJ-7', dependsOn: ['PROJ-8'], files: ['src/g.ts'] }
  let a = 0
  const { calls, result } = await run('C3 · a replan that re-enters an unclaimed tracker issue claims it', [A, B], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label === 'impl:PROJ-8') return a++ === 0 ? { status: 'BLOCKED', summary: 'x' } : IMPL_OK
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'split', learnings: [], tasks: [{ ...A, taskText: 'retry' }, { ...B, dependsOn: [] }] }
    if (label.startsWith('claim#')) return { released: ['PROJ-7'] }
    if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'ccccccc' } // the two retries run as parallel lanes
    return PASSV
  }, { extraArgs: { ...QUIET, claim: { identity: 'grimoire-bot' } } })
  const c = calls.find((x) => x.label.startsWith('claim#'))
  ok(!!c && /Mode: \*\*CLAIM\*\*/.test(c.prompt) && /PROJ-7/.test(c.prompt) && !/PROJ-8 \(/.test(c.prompt), 'only the never-hydrated issue is claimed, in CLAIM mode')
  ok(result.done.length === 2 && !calls.some((x) => x.label === 'release-claims'), 'both land; nothing to release')
}

// ── 7 · the decision journal ──
// A faithful writer: parses the script it was handed, "runs" it, reports the counts it would print.
const writes = []
function journalWriter(prompt, { lie = false } = {}) {
  const heredocs = [...prompt.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => m[1])
  const lines = heredocs[0]
  const run = JSON.parse(heredocs[1])
  const file = (/F="\$DIR\/events\/(\d{8})\.jsonl"/.exec(prompt) || [])[1]
  const dir = (/^DIR='([^']+)'$/m.exec(prompt) || [])[1] || '.grimoire/runs/20260923-120000-PROJ-600'
  writes.push({ file, dir, events: lines.split('\n').map((l) => JSON.parse(l)), run })
  const n = lines.split('\n').length
  return { runDir: dir, lines: lie ? n - 1 : n, bytes: Buffer.byteLength(lines + '\n', 'utf8') }
}
{
  writes.length = 0
  const { result, labels, logs } = await run('J1 · the journal writes chunked, checked, with a run.json checkpoint', [TASK], (label, prompt) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('journal#')) return journalWriter(prompt)
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: { precheck: false, verifyFindings: false, runId: 'run-7', runMeta: { grimoireVersion: '0.6.0', briefsHash: 'abc123' }, telemetry: { flushEvery: 3 } } })
  const events = writes.flatMap((w) => w.events)
  const types = events.map((e) => e.type)
  ok(labels.filter((l) => l.startsWith('journal#')).length === writes.length && writes.length >= 2, `flushed in ${writes.length} chunk(s) of ≤ 3`)
  ok(writes.every((w) => w.dir === '.grimoire/runs/run-7'), 'every chunk goes to <telemetryDir>/<runId>')
  ok(writes.every((w) => w.file === String(w.events[0].seq).padStart(8, '0')), 'each chunk file is named by its first seq (a retried flush overwrites, never duplicates)')
  ok(events.every((e, i) => e.seq === i + 1), 'sequence numbers are gap-free and ordered')
  for (const t of ['run.start', 'route', 'dispatch', 'review', 'settle', 'run.end']) ok(types.includes(t), `emits ${t}`)
  ok(events.every((e) => e.at === '__AT__'), 'wall time is left for the shell to stamp')
  const last = writes[writes.length - 1].run
  ok(last.status === 'drained' && last.meta.grimoireVersion === '0.6.0' && last.checkpoint.landed.includes('PROJ-1'), 'the last run.json carries the final status, meta and checkpoint')
  ok(result.telemetry.journal.written === events.length && result.telemetry.journal.mismatches === 0, 'the receipt matched for every chunk')
  const start = events.find((e) => e.type === 'run.start')
  ok(start.meta.briefsHash === 'abc123', 'run.start is tagged with the briefs hash')
  ok(!logs.some((m) => /telemetry chunk/.test(m)), 'no mismatch warning')
}
{
  writes.length = 0
  const { result, logs } = await run('J2 · a writer that reports the wrong counts is detected', [TASK], (label, prompt) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('journal#')) return journalWriter(prompt, { lie: true })
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: { precheck: false, verifyFindings: false, runId: 'run-8' } })
  ok(result.telemetry.journal.mismatches >= 1 && logs.some((m) => /may be altered/.test(m)), 'mismatch counted and logged')
}
{
  const { labels, result } = await run('J3 · no journal in a preview, or with telemetry off', [TASK], () => PASSV, { extraArgs: { execute: false } })
  ok(!labels.some((l) => l.startsWith('journal#')) && result.preview, 'preview: nothing written')
  const r2 = await run('J3b · telemetry.enabled:false', [TASK], (label) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: QUIET })
  ok(!r2.labels.some((l) => l.startsWith('journal#')) && r2.result.telemetry.journal === null, 'off: nothing written')
}
{
  writes.length = 0
  const { labels, calls, result } = await run('J4 · resume from a checkpoint: replans used, learnings and sequence carry over', [TASK], (label, prompt) => {
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('journal#')) return journalWriter(prompt)
    if (label.startsWith('impl:')) return { status: 'BLOCKED', summary: 'stuck' }
    return PASSV
  }, { extraArgs: { precheck: false, verifyFindings: false, runId: 'run-9', maxReplans: 1, resumeState: { replansUsed: 1, learnings: [{ text: 'the cache must be warmed first', repos: ['api'] }], lastSeq: 41, fixRounds: { 'PROJ-1': 2 } } } })
  ok(!labels.some((l) => l.startsWith('replan')), 'the replan budget spent in the earlier session is honoured')
  ok(result.needsAttention.some((r) => r.id === 'PROJ-1' && r.status === 'BLOCKED') && result.replans === 1, 'the failure is reported, with the carried replan count')
  ok(/the cache must be warmed first/.test(calls.find((c) => c.label.startsWith('hydrate:')).prompt), 'carried learnings reach hydration')
  ok(writes[0].events[0].seq === 42, 'sequence numbers continue from the checkpoint')
}

// ── 8 · learnings by relevance ──
{
  const { calls } = await run('L1 · hydration carries learnings for its own repos plus pipeline-wide ones', [TASK], (label) => {
    if (label === 'harness-context')
      return { harnessMemory: '', agentMemory: {}, priorLedgers: ['runs/a.json'], priorLearnings: [
        { text: 'api: pin the serializer', repos: ['api'] },
        { text: 'infra: plan before apply', repos: ['infra'] },
        { text: 'always name the ticket in the PR title', repos: [] },
      ] }
    const l = learning(label); if (l !== undefined) return l
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { extraArgs: QUIET })
  const hyd = calls.find((c) => c.label.startsWith('hydrate:')).prompt
  ok(/pin the serializer/.test(hyd) && /name the ticket/.test(hyd), 'its repo and the global learning are carried')
  ok(!/plan before apply/.test(hyd), "another repo's learning is not")
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
