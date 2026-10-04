// ════════════════════════════════════════════════════════════════════════════
//  Run durability: time limits, hedges, hydration prefetch (0.9.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-timeouts.test.mjs
//
//  Grounded in a real unattended run (grimoire 0.8.0, one static-site repo, ten issues in a strict
//  blocked-by chain) that took about 29 hours over three attempts and ended with zero PRs:
//    • DIED BUT STILL WORKING — two implementers were booked DIED at the 40-min backstop and kept
//      running for 78 and 115 minutes. The loop replanned and dispatched retries into the same
//      checkout while they were still committing ("repair of a stray agent's damage"). A timeout
//      now makes a dispatch LATE: it is awaited, a late valid result is accepted, and a writer past
//      its hard limit is WEDGED — its repo fenced, nothing re-dispatched into it (L1–L4, L9)
//    • A LATE HYDRATION HALTED THE RUN — it took 43 minutes and returned a valid result, but the
//      run had already stopped as "hydration died". It is now accepted, and a null hydration is
//      retried once (L5, L6)
//    • SLOW AGENTS READ AS AN OUTAGE — the circuit breaker counted timeouts as deaths (L7)
//    • A ONE-WORD PREFLIGHT TOOK 12 MINUTES — preflight and precheck get short limits and a
//      hedged duplicate; the precheck runs one fact script instead of eight git calls; a hung
//      journal writer no longer holds the end of the run (T-1 to T-3)
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget).
//  Timers are real: limits are fractional minutes (0.001 min = 60 ms).
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const deferred = () => { let resolve; const promise = new Promise((r) => (resolve = r)); return { promise, resolve } }
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
const HANG = () => new Promise(() => {})

const API = { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }
const INFRA = { name: 'infra', path: 'repositories/infra', agent: 'infra-engineer', tags: ['infra'], gate: null }
const WEB = { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['web'], gate: null }
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: [API] }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const FAST = { agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.005 } // soft 60 ms · writer hard 300 ms
const PROBE = { toolLatencySec: 3, repoRoots: [{ name: 'api', root: '/home/ana/ws/repositories/api', branch: 'main' }], home: '/home/ana' }

const T = (id, extra = {}) => ({ id, ticket: id, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: `Build ${id}`, deferred: false, files: [`src/${id.toLowerCase()}.ts — add it`], ...extra })
const IN = (id, extra = {}) => T(id, { repo: 'infra', agent: 'infra-engineer', files: [`infra/${id.toLowerCase()}.tf — add it`], ...extra })
const WB = (id, extra = {}) => T(id, { repo: 'web', agent: 'web-engineer', files: [`web/${id.toLowerCase()}.html — add it`], ...extra })
const IMPL_OK = { status: 'DONE', summary: 'built it', commits: ['aaaaaaa'], baseSha: '0000000', startSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const happy = (label) => {
  if (label.startsWith('impl:') || label.startsWith('fix:')) return IMPL_OK
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
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
async function run(scenario, tasks, responder, { args = {}, index = PROBE, hydrate } = {}) {
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
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  const labels = calls.map((c) => c.label)
  return { result, calls, logs, labels, ms: Date.now() - t0, at: (l) => labels.indexOf(l), prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}

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

// ══════════════ L · a timeout makes a dispatch LATE, not dead ══════════════
{
  const { result, labels, logs } = await run('L1 · an implementer past its soft limit is waited for; its late result lands the task', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return later(200, IMPL_OK)
    return happy(label)
  }, { args: { ...QUIET, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.01 } })
  ok(result.done.some((d) => d.id === 'PROJ-1') && !result.halt, 'PROJ-1 landed, no halt')
  ok(!labels.some((l) => l.startsWith('replan')), 'no replan')
  eq(labels.filter((l) => l.startsWith('impl:')), ['impl:PROJ-1'], 'no second implementer dispatch')
  eq(result.telemetry.late.filter((l) => l.label === 'impl:PROJ-1'), [{ label: 'impl:PROJ-1', kind: 'writer', softMin: 0.001, outcome: 'accepted' }], 'telemetry.late: impl:PROJ-1, a writer, accepted')
  ok(logs.some((l) => /⏳ \[late\] impl:PROJ-1 past 0\.001m — still waiting \(hard 0\.01m\); the agent is not stopped/.test(l)), 'a [late] log line')
  eq(result.telemetry.timedOut, [], 'timedOut is empty — nothing was given up on')
  eq(result.telemetry.wedged, [], 'nothing wedged')
}
{
  const { result, labels, logs } = await run('L2 · an implementer that never returns is WEDGED at its hard limit: no replan, no retry into its checkout', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return HANG()
    if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'retry it', learnings: [], tasks: [T('PROJ-1')] }
    return happy(label)
  }, { args: { ...QUIET, ...FAST } })
  ok(/^still running: impl:PROJ-1 in api passed the 0\.005-min hard limit and has not returned; it may still commit — let it finish \(git log, ps\) before resuming$/.test((result.halt || {}).reason || ''), 'halt reason: still running, may still commit, let it finish')
  eq((result.halt || {}).kind, 'wedged', 'halt kind: wedged')
  ok(!labels.some((l) => l.startsWith('replan')), 'no replan')
  eq(labels.filter((l) => l.startsWith('impl:')), ['impl:PROJ-1'], 'no second impl: for PROJ-1')
  eq(result.needsAttention, [{ id: 'PROJ-1', repo: 'api', status: 'STILL_RUNNING', label: 'impl:PROJ-1' }], 'needsAttention: STILL_RUNNING')
  eq(result.telemetry.wedged, ['impl:PROJ-1'], 'telemetry.wedged has impl:PROJ-1')
  eq(result.telemetry.late.map((l) => [l.label, l.outcome]), [['impl:PROJ-1', 'wedged']], 'telemetry.late: outcome wedged')
  eq(result.blocked, [], 'not reported as never-ran')
  ok(logs.some((l) => /⛔ \[wedged\] impl:PROJ-1 in api passed its 0\.005-min hard limit .*api is FENCED/.test(l)), 'the wedge is logged, naming the fence')
}
{
  const { result, labels } = await run('L3 · api wedged, infra keeps going: infra drains and gates, then the run halts', [T('PROJ-1'), IN('PROJ-2'), IN('PROJ-3', { dependsOn: ['PROJ-2'] })], (label) => {
    if (label === 'impl:PROJ-1') return HANG()
    return happy(label)
  }, { args: { ...QUIET, ...FAST, repos: [API, INFRA] } })
  ok(labels.includes('impl:PROJ-2') && labels.includes('impl:PROJ-3'), "infra's two tasks ran")
  eq(result.done.map((d) => d.id).sort(), ['PROJ-2', 'PROJ-3'], 'both infra tasks landed')
  ok(labels.includes('gate:infra') && !labels.includes('gate:api'), "infra's terminal slot ran; api's did not")
  ok(/^still running: impl:PROJ-1 in api/.test((result.halt || {}).reason || ''), 'the run halted on the wedged api implementer, after infra drained')
  ok(result.prs.some((p) => p.repo === 'infra'), "infra's PR opened")
}
{
  // PROJ-2 is independent of PROJ-1 and has disjoint files, but becomes ready (its blocker in infra
  // lands) only AFTER PROJ-1 wedged: the fenced repo takes nothing new.
  const { result, labels } = await run('L4 · a fenced repo takes no new task, even one with disjoint files', [T('PROJ-1'), IN('PROJ-3'), T('PROJ-2', { dependsOn: ['PROJ-3'] })], (label) => {
    if (label === 'impl:PROJ-1') return HANG()
    if (label === 'impl:PROJ-3') return later(450, IMPL_OK)
    return happy(label)
  }, { args: { ...QUIET, ...FAST, repos: [API, { ...INFRA, timeoutMin: 0.01 }], maxPerRepo: 3 } }) // infra's writers: soft 600 ms, so its blocker is merely slow
  ok(labels.includes('impl:PROJ-3') && result.done.some((d) => d.id === 'PROJ-3'), 'the infra blocker landed (after the wedge)')
  ok(!labels.includes('impl:PROJ-2'), 'no impl:PROJ-2 — api is fenced')
  ok(result.blocked.some((b) => b.id === 'PROJ-2'), 'PROJ-2 is reported blocked, never ran')
  ok(/^still running: impl:PROJ-1 in api/.test((result.halt || {}).reason || ''), 'halt: still running')
}
{
  const { result, labels } = await run('L5 · a hydration past its soft limit is accepted (the 43-min hydration case)', [T('PROJ-1')], happy, {
    args: { ...QUIET, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.01 },
    hydrate: (label, _p, def) => (label === 'hydrate:w1' ? later(200, def()) : undefined),
  })
  ok(!result.halt && result.done.some((d) => d.id === 'PROJ-1'), 'no halt; the task ran and landed')
  ok(!labels.includes('hydrate:w1~r1'), 'no retry was needed')
  eq(result.telemetry.late.filter((l) => l.kind === 'hydrate').map((l) => [l.label, l.outcome]), [['hydrate:w1', 'accepted']], 'the late hydration was accepted')
}
{
  const { result, labels, logs } = await run('L6 · a null hydration is retried once before the run stops', [T('PROJ-1')], happy, {
    args: QUIET,
    hydrate: (label) => (label === 'hydrate:w1' ? null : undefined),
  })
  ok(labels.includes('hydrate:w1~r1') && labels.indexOf('hydrate:w1~r1') === labels.indexOf('hydrate:w1') + 1, 'hydrate:w1~r1 dispatched right after the null')
  ok(!result.halt && result.done.some((d) => d.id === 'PROJ-1'), 'the run continued and the task landed')
  ok(logs.some((l) => /retrying it once/.test(l)), 'the retry is logged')
  const dead = await run('L6b · null twice → the run stops, saying so', [T('PROJ-1')], happy, { args: QUIET, hydrate: () => null })
  ok(/hydration died on cycle 1 \(PROJ-1\), twice/.test((dead.result.halt || {}).reason || '') && !dead.labels.some((l) => l.startsWith('impl:')), 'halted after the retry, nothing dispatched')
}
{
  const tasks = [T('PROJ-1'), IN('PROJ-2'), WB('PROJ-3')]
  const { result } = await run('L7 · three late implementers in three repos, each accepted: no circuit-breaker halt', tasks, (label) => {
    if (label.startsWith('impl:')) return later(200, IMPL_OK)
    return happy(label)
  }, { args: { ...QUIET, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.01, repos: [API, INFRA, WEB] } })
  ok(!result.halt, 'no halt')
  eq(result.done.map((d) => d.id).sort(), ['PROJ-1', 'PROJ-2', 'PROJ-3'], 'all three landed')
  eq(result.telemetry.late.filter((l) => l.kind === 'writer').map((l) => l.outcome), ['accepted', 'accepted', 'accepted'], 'three late writers, all accepted')
  const died = await run('L7b · three implementers that ran late, then returned nothing: they were working — the breaker does not trip', tasks, (label) => {
    if (label.startsWith('impl:')) return later(150, null)
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop here', learnings: [] }
    return happy(label)
  }, { args: { ...QUIET, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.01, repos: [API, INFRA, WEB] } })
  ok(!/three consecutive dispatches died/.test((died.result.halt || {}).reason || '') && died.labels.includes('replan#1'), 'no "API outage" halt; the failures went to a replan')
  const quick = await run('L7c · three quick nulls still trip it', tasks, (label) => (label.startsWith('impl:') ? null : happy(label)), { args: { ...QUIET, repos: [API, INFRA, WEB] } })
  ok(/three consecutive dispatches died/.test((quick.result.halt || {}).reason || ''), 'quick nulls are an outage signal, as before')
}
{
  // PROJ-2 is admitted as a LANE next to the direct PROJ-1 (disjoint files, ready once PROJ-3 lands);
  // its integration waits for PROJ-1, which then wedges in the primary checkout.
  const { result, labels } = await run('L9 · a lane held behind a wedged direct writer settles FENCED, its worktree left in place', [T('PROJ-1'), IN('PROJ-3'), T('PROJ-2', { dependsOn: ['PROJ-3'] })], (label) => {
    if (label === 'impl:PROJ-1') return HANG()
    return happy(label)
  }, { args: { ...QUIET, ...FAST, repos: [API, INFRA] } })
  ok(labels.includes('impl:PROJ-2') && !labels.includes('integrate:PROJ-2'), 'the lane was built and reviewed, but never integrated')
  ok(result.needsAttention.some((r) => r.id === 'PROJ-2' && r.status === 'FENCED'), 'PROJ-2 → FENCED')
  ok(result.needsAttention.some((r) => r.id === 'PROJ-1' && r.status === 'STILL_RUNNING'), 'PROJ-1 → STILL_RUNNING')
  ok(!labels.some((l) => l.startsWith('replan')), 'no replan into the fenced repo')
  ok(/^still running: impl:PROJ-1 in api/.test((result.halt || {}).reason || ''), 'halt: still running')
}
{
  const { calls } = await run('L10 · the journal records late, wedged and fence; a late result that arrives is recorded too', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return HANG()
    return happy(label)
  }, { args: { ...QUIET, ...FAST, telemetry: {} } })
  const ev = journalEvents(calls)
  const one = (type) => ev.find((e) => e.type === type) || {}
  ok(one('late').label === 'impl:PROJ-1' && one('late').task === 'PROJ-1' && one('late').kind === 'writer' && one('late').softMin === 0.001, 'late {label, task, kind, softMin}')
  ok(one('wedged').label === 'impl:PROJ-1' && one('wedged').repo === 'api' && one('wedged').hardMin === 0.005, 'wedged {label, task, repo, hardMin}')
  ok(one('fence').repo === 'api' && one('fence').action === 'hold', 'fence {repo, action: hold}')
  const back = await run('L10b · …and late-result {accepted: true} when a late result lands', [T('PROJ-1')], (label) => (label === 'impl:PROJ-1' ? later(150, IMPL_OK) : happy(label)), { args: { ...QUIET, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.01, telemetry: {} } })
  const lr = journalEvents(back.calls).find((e) => e.type === 'late-result') || {}
  ok(lr.label === 'impl:PROJ-1' && lr.accepted === true && lr.status === 'DONE', 'late-result {label, task, accepted, status}')
}
{
  console.log('\n── L11 · the briefs: a late agent is waited for; a STILL_RUNNING task holds its repo')
  const replan = readFileSync(`${DIR}/briefs/replan.md`, 'utf8')
  ok(/## A late agent is waited for/.test(replan) && /STILL_RUNNING/.test(replan) && /never requeue it or anything in its checkout/.test(replan), 'replan: a STILL_RUNNING task holds its repo')
  ok(!/booked as DIED, but nothing stops it/.test(replan), 'replan: the "DIED task may still be running" section is gone')
  const impl = readFileSync(`${DIR}/briefs/implement.md`, 'utf8')
  ok(/not cut off at its time limit; it is waited for/.test(impl) && /so a later\s+session can absorb it/.test(impl), 'implement: waited for, not cut off; commit so a later session can absorb it')
}

// ══════════════ T · short limits and a hedge for mechanical dispatches ══════════════
{
  const { result, labels, logs, calls } = await run('T-1 · a silent preflight is hedged; the duplicate answers and the run starts', [T('PROJ-1')], (label) => {
    if (label === 'preflight:grimoire:reviewer') return HANG()
    return happy(label)
  }, { args: { ...QUIET, timeouts: { preflight: { soft: 0.001, hard: 0.01, hedgeAfter: 0.001 } } } })
  ok(labels.includes('preflight:grimoire:reviewer~h1'), 'the hedge preflight:grimoire:reviewer~h1 was dispatched')
  ok(!labels.includes('preflight:grimoire:reviewer~r1') && !result.error, 'no re-probe round, no refusal: the hedge answered')
  ok(logs.some((l) => /⏳ \[hedge\] preflight:grimoire:reviewer has not answered after 0\.001m/.test(l)), 'a hedge log line')
  const impl = calls.find((c) => c.label === 'impl:PROJ-1')
  ok(impl && impl.at < 450 && result.done.length === 1, `the run started well under the 600 ms hard limit (impl at ${impl && impl.at} ms) and landed`)
  ok(/Your first and only action is the structured reply/.test((calls.find((c) => c.label.startsWith('preflight:')) || {}).prompt || ''), 'the preflight prompt says: reply only, read nothing, run nothing')
}
{
  const { result, labels } = await run('T-2 · every journal writer hangs: the run ends anyway, chunks counted lost', [T('PROJ-1')], (label) => {
    if (label.startsWith('journal#')) return HANG()
    return happy(label)
  }, { args: { ...QUIET, telemetry: {}, timeouts: { journal: { soft: 0.001, hard: 0.005 } } } })
  ok(labels.includes('ledger'), 'the ledger is still dispatched')
  ok(result.telemetry.journal && result.telemetry.journal.lost >= 1, `telemetry.journal.lost ≥ 1 (got ${result.telemetry.journal && result.telemetry.journal.lost})`)
  ok(result.telemetry.timedOut.some((l) => l.startsWith('journal#')), 'the hung writer is listed as given up on')
}
{
  const { result, labels, prompt } = await run('T-3 · the precheck runs one fact script; a silent precheck is hedged', [T('PROJ-1')], (label) => {
    if (label === 'precheck:PROJ-1') return HANG()
    return happy(label)
  }, { args: { verifyFindings: false, telemetry: { enabled: false }, timeouts: { precheck: { soft: 0.001, hard: 0.01, hedgeAfter: 0.001 } } } })
  const p = prompt('precheck:PROJ-1')
  ok(/## The fact sheet — run this ONCE, in one Bash call/.test(p), 'the precheck prompt carries the fact sheet')
  ok(p.includes('git -C repositories/api rev-list --count 0000000..aaaaaaa') && p.includes('git -C repositories/api diff --name-status 0000000..aaaaaaa'), 'it counts the commits and lists the files of the exact range')
  ok(/merge-base --is-ancestor 0000000 aaaaaaa; echo "exit \$\?"/.test(p) && /merge-base --is-ancestor aaaaaaa feat\/proj-700-api; echo "exit \$\?"/.test(p), 'and prints the range-start and run-branch ancestry exits')
  ok(labels.includes('precheck:PROJ-1~h1') && !labels.includes('precheck:PROJ-1#1'), 'precheck:PROJ-1~h1 answered for the silent one — no fix round')
  ok(result.done.some((d) => d.id === 'PROJ-1'), 'the task landed')
}
{
  // The fact sheet, RUN in bash against a real repo: the marker scan must report file:line of ADDED lines only.
  const repo = mkdtempSync(join(tmpdir(), 'grimoire-facts-'))
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src/old.ts'), '// TODO pre-existing\nexport const old = 1\n')
  git('add', '.'); git('commit', '-q', '-m', 'base')
  const base = git('rev-parse', 'HEAD').stdout.trim()
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1\n// TODO finish this\n=======\nconst ok = true\n')
  writeFileSync(join(repo, 'src/old.ts'), '// TODO pre-existing\nexport const old = 2\n')
  git('add', '.'); git('commit', '-q', '-m', 'change')
  const head = git('rev-parse', 'HEAD').stdout.trim()
  const { prompt } = await run('T-3b · the fact sheet, run in bash, reports what each check needs', [T('PROJ-1')], (label) => {
    if (label === 'impl:PROJ-1') return { ...IMPL_OK, commits: [head], baseSha: base, startSha: base, headSha: head }
    return happy(label)
  }, { args: { verifyFindings: false, telemetry: { enabled: false }, repos: [{ ...API, path: repo }] } })
  const script = (/## The fact sheet[^\n]*\n```bash\n([\s\S]*?)\n```/.exec(prompt('precheck:PROJ-1')) || [])[1] || ''
  const out = spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout
  ok(/== commits\n1\n/.test(out), 'one commit in the range')
  ok(/A\tsrc\/a\.ts/.test(out) && /M\tsrc\/old\.ts/.test(out), 'the files, with their change type')
  ok(out.includes('src/a.ts:2: // TODO finish this') && out.includes('src/a.ts:3: ======='), 'added stub and conflict markers, as file:line')
  ok(!out.includes('pre-existing'), 'a marker the diff did not add is not listed')
  ok(/== range start \(check 8\)\nexit 0/.test(out) && /== on the run branch \(check 7\)\nexit (1|128)/.test(out), 'the ancestry exits are printed (the run branch does not exist in this scratch repo)')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
