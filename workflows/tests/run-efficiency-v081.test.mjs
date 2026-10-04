// ════════════════════════════════════════════════════════════════════════════
//  Run efficiency and honest reporting (0.8.1) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-efficiency-v081.test.mjs
//
//  Grounded in a real unattended run (six issues, one repo) that took 9 h 10 for about
//  2 h 45 of work, and whose journal and transcripts showed each of these defects:
//    • A HANGING HOOK NOBODY SAW — a PreToolUse hook timed out at 30 s before each of the run's
//      836 Bash calls (6.4 h of wall-clock); the run read it as slow builds. A startup session
//      probe now measures it and refuses to start past a limit
//    • A TIMED-OUT AGENT KEPT WORKING — the backstop booked the implementer DIED and it committed
//      three minutes later; the replanner is now told so, and what to check
//    • A WRONG LESSON — the replan blamed slow tests and proposed a repo timeoutMin that can only
//      raise the backstop; the engine warns about a no-op timeoutMin and the replanner gets the
//      measured latency
//    • A RECOVERED TASK IN needsAttention — a task that died, was requeued and landed was still
//      reported as needing attention
//    • A WRONG NOTE — "no PR this run, so no crystallize" when a PR existed and crystallize died
//    • HARNESS FIXES IN THE PRODUCT PR — a terminal blocker on the loop's own config bought a
//      37-minute fix round and three harness commits in the product PR
//    • A PR THAT CLOSED NOTHING — the gate (on opus) opened a one-line PR that linked no issue
//    • ABSOLUTE PATHS IN A PUBLIC LEDGER — reviewers' home-directory paths went into runs/*.json
//    • A STACKED LEDGER BRANCH — cut from an unmerged base, so the ledger PR carried its commits
//    • CRYSTALLIZE CUT AT 40 MIN — the longest dispatch of a run now has its own allowance
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

const REPOS = [{ name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const ROOT = '/home/ana/ws/repositories/api'
const PROBE = { toolLatencySec: 3, repoRoots: [{ name: 'api', root: ROOT, branch: 'main' }], home: '/home/ana' }

const TASK = { id: 'PROJ-1', ticket: 'PROJ-1', repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: 'Build it', deferred: false, branch: 'feat/x', files: ['src/a.ts — add a'] }
const TASK2 = { ...TASK, id: 'PROJ-2', ticket: 'PROJ-2', order: 2, files: ['src/b.ts — add b'], dependsOn: ['PROJ-1'] }
const IMPL_OK = { status: 'DONE', summary: 'Built it; npm audit went from 6 advisories to 0', commits: ['aaaaaaa'], baseSha: '0000000', startSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const FIX_OK = { status: 'DONE', summary: 'fixed', commits: ['bbbbbbb'], headSha: 'bbbbbbb' }
const GATE_OK = { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
const CRY_OK = { reports: ['r'], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 1, docsSynced: [], prUrl: 'https://github.com/x/y/pull/10', summary: 'one fact' }
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const happy = (label) => {
  if (label.startsWith('impl:')) return IMPL_OK
  if (label.startsWith('fix:')) return FIX_OK
  if (label.startsWith('gate:')) return GATE_OK
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

async function run(scenario, tasks, responder, { args = {}, index = PROBE, crystallize = CRY_OK } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks, index)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)) }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return typeof crystallize === 'function' ? crystallize() : crystallize
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  return { result, calls, logs, labels: calls.map((c) => c.label), prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}

// ══════════════ 1 · the session probe ══════════════
{
  const { result, labels } = await run('1a · a session whose Bash calls wait 31 s refuses to start', [TASK], happy, { args: QUIET, index: { ...PROBE, toolLatencySec: 31 } })
  eq(result.error, 'slow_tool_calls', 'refused as slow_tool_calls')
  ok(result.toolLatencySec === 31, 'the measured latency is reported')
  ok(!labels.some((l) => l.startsWith('hydrate:') || l.startsWith('impl:')), 'nothing hydrated, no implementer dispatched')
  ok(/hook/.test(result.note) && /maxToolLatencySec:0/.test(result.note), 'the note names the likely cause and the override')
}
{
  const { result, labels, logs } = await run('1b · {maxToolLatencySec:0} runs anyway and still warns', [TASK], happy, { args: { ...QUIET, maxToolLatencySec: 0 }, index: { ...PROBE, toolLatencySec: 31 } })
  ok(labels.includes('impl:PROJ-1') && result.done.length === 1, 'the run went ahead')
  ok(logs.some((l) => /session probe: a trivial Bash call waits ~31s/.test(l)), 'the latency is logged as a warning')
  ok(result.telemetry.toolLatencySec === 31, 'and reported in telemetry')
}
{
  const { result, logs, prompt } = await run('1c · a 3 s session runs; the execute index prompt carries the probe', [TASK], happy, { args: QUIET })
  ok(!result.error && result.done.length === 1, 'the run proceeds')
  ok(logs.some((l) => /✓ session probe: ~3s/.test(l)), 'logged as fine')
  ok(/PROBE this session/.test(prompt('parse-index')) && /rev-parse --show-toplevel/.test(prompt('parse-index')), 'the index prompt asks for the latency and the checkout roots')
  const prev = await run('1d · a preview never probes', [TASK], happy, { args: { ...QUIET, execute: false } })
  ok(prev.result.preview === true && !/PROBE this session/.test(prev.prompt('parse-index')), 'no probe in a preview')
  const blind = await run('1e · no number reported → the run proceeds and says it cannot tell', [TASK], happy, { args: QUIET, index: {} })
  ok(blind.result.done.length === 1 && blind.logs.some((l) => /no tool latency reported/.test(l)), 'proceeds, with a warning')
}

// ══════════════ 2 · a task that died and later landed is recovered, not open ══════════════
{
  let n = 0
  const { result, logs } = await run('2 · DIED → requeued by a replan → landed: needsAttention stays empty', [TASK], (label) => {
    if (label.startsWith('impl:')) return n++ === 0 ? null : IMPL_OK
    if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'it died; retry', learnings: ['retry a dead dispatch'], tasks: [{ ...TASK }] }
    return happy(label)
  }, { args: QUIET })
  ok(result.done.some((d) => d.id === 'PROJ-1'), 'PROJ-1 landed')
  eq(result.needsAttention, [], 'needsAttention is empty')
  eq(result.recovered, [{ id: 'PROJ-1', repo: 'api', failedAs: 'DIED' }], 'the dead attempt is listed under recovered')
  ok(logs.some((l) => /needs-attention: 0 \(\+1 recovered after a replan\)/.test(l)), 'the summary line counts it as recovered')
}

// ══════════════ 3 · a timed-out implementer may still be running ══════════════
{
  let n = 0
  const { calls, result, logs } = await run('3 · the replanner is told a timed-out agent may still commit, and sees the measured latency', [TASK], (label) => {
    if (label.startsWith('impl:')) return n++ === 0 ? new Promise(() => {}) : IMPL_OK
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop here', learnings: [] }
    return happy(label)
  }, { args: { ...QUIET, agentTimeoutMin: 0.001 }, index: { ...PROBE, toolLatencySec: 4 } })
  const rp = (calls.find((c) => c.label === 'replan#1') || {}).prompt || ''
  ok(/does NOT stop the agent/.test(rp) && /verify-and-report/.test(rp), 'the failure detail says it may still be running, and what to do')
  ok(/~4s before it ran/.test(rp), 'the replan prompt carries the measured tool latency')
  ok(logs.some((l) => /\[timeout\] impl:PROJ-1 .*may still commit/.test(l)), 'the timeout log says the agent is not stopped')
  ok(result.telemetry.timedOut.includes('impl:PROJ-1'), 'telemetry lists the timed-out dispatch')
}

// ══════════════ 4 · a repo timeoutMin under the backstop is a no-op, and said so ══════════════
{
  const a = await run('4a · timeoutMin 30 under the 40-min backstop is called out', [TASK], happy, { args: { ...QUIET, repos: [{ ...REPOS[0], timeoutMin: 30 }] } })
  ok(a.logs.some((l) => /repos\[api\]\.timeoutMin 30 has no effect/.test(l)), 'warned')
  const b = await run('4b · timeoutMin 60 raises it — no warning', [TASK], happy, { args: { ...QUIET, repos: [{ ...REPOS[0], timeoutMin: 60 }] } })
  ok(!b.logs.some((l) => /has no effect/.test(l)), 'not warned')
}

// ══════════════ 5 · harness findings in the terminal sweep go to crystallize ══════════════
{
  const { result, labels, logs, prompt } = await run('5a · a terminal blocker on the loop config buys no product fix round', [TASK], (label) => {
    if (label.startsWith('reliability-sre')) return V('FAIL', [{ severity: 'blocker', file: `${ROOT}/grimoire.config.json`, line: 30, issue: 'laneSetup symlinks node_modules' }])
    return happy(label)
  }, { args: QUIET })
  ok(!labels.some((l) => l.startsWith('fix:')), 'no fix dispatched on the product branch')
  ok(labels.includes('gate:api') && result.prs.length === 1, 'the gate ran and the PR opened')
  const note = result.advisoryNotes.find((n) => n.harness)
  ok(note && note.severity === 'blocker' && note.where === `${ROOT}/grimoire.config.json:30`, 'kept as an advisory note tagged harness')
  ok(/grimoire\.config\.json:30 — laneSetup symlinks node_modules/.test(prompt('crystallize')), "crystallize's header lists it, repo-relative")
  ok(logs.some((l) => /routed to crystallize/.test(l)), 'the routing is logged')
}
{
  const { labels } = await run('5b · the same blocker on product code still gets its fix round', [TASK], (label) => {
    if (label.startsWith('reliability-sre')) return label.includes('#') ? V('PASS') : V('FAIL', [{ severity: 'blocker', file: `${ROOT}/src/app.ts`, line: 3, issue: 'crash on start' }])
    return happy(label)
  }, { args: QUIET })
  ok(labels.some((l) => l.startsWith('fix:api:final:terminal')), 'a terminal fix round was dispatched')
}
{
  const { labels } = await run('5c · per-task review: a blocker on a harness file the task changed still gates', [TASK], (label) => {
    if (label.startsWith('break-it')) return label.includes('#') ? V('PASS') : V('FAIL', [{ severity: 'major', file: '.claude/agents/backend-engineer.md', line: 2, issue: 'stale stack line' }])
    return happy(label)
  }, { args: QUIET })
  ok(labels.some((l) => l.startsWith('fix:PROJ-1:quality')), 'routing is terminal-only: the task fixes its own change')
}

// ══════════════ 6 · the gate writes a PR that closes what landed ══════════════
{
  const { prompt, calls } = await run('6 · the gate runs on sonnet and is handed every landed issue', [TASK, TASK2], happy, { args: QUIET })
  const g = calls.find((c) => c.label === 'gate:api')
  eq(g && g.opts.model, 'sonnet', 'gate model is sonnet')
  const p = prompt('gate:api')
  ok(/Landed in this repo this run/.test(p) && p.includes('PROJ-1 — Title of PROJ-1') && p.includes('PROJ-2 — Title of PROJ-2'), 'both landed issues are listed with their titles')
  ok(p.includes('npm audit went from 6 advisories to 0'), "each implementer's report travels to the PR body")
  ok(/PR title and body/.test(p), 'the brief section that sets the body rules is named')
}

// ══════════════ 7 · the ledger: repo-relative paths, default-branch base ══════════════
{
  const { prompt } = await run('7 · the ledger carries no checkout or home path and is cut from the default branch', [TASK], (label) => {
    if (label.startsWith('break-it')) return V('PASS', [
      { severity: 'minor', file: `${ROOT}/src/a.ts`, line: 3, issue: 'x' },
      { severity: 'nit', file: `${ROOT}/.worktrees/lane-1/src/b.ts`, line: 4, issue: 'y' },
      { severity: 'nit', file: '/home/ana/notes/c.md', line: 1, issue: 'z' },
    ])
    return happy(label)
  }, { args: { ...QUIET, baseBranch: 'origin/chore/setup' } })
  const lp = prompt('ledger')
  // 0.9.0: the payload travels base64 — the writer copies it into the file and never reads it
  const payload = Buffer.from(((/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/.exec(lp) || [])[1] || '').replace(/\s+/g, ''), 'base64').toString('utf8')
  ok(payload.includes('"where": "src/a.ts:3"'), 'a checkout path becomes repo-relative')
  ok(payload.includes('"where": "src/b.ts:4"'), 'a lane prefix under the checkout is dropped')
  ok(payload.includes('"where": "~/notes/c.md:1"'), 'the home directory becomes ~')
  ok(!payload.includes('/home/ana') && !lp.includes('/home/ana'), 'no absolute home path is left anywhere in the payload')
  ok(!lp.includes('"where"') && !lp.includes('"advisoryNotes"'), 'the prompt itself carries no raw payload text')
  ok(/origin\/HEAD/.test(lp) && /never the run's base branch `origin\/chore\/setup`/.test(lp), 'the ledger branch is cut from the default branch')
}

// ══════════════ 8 · crystallize: its own allowance, and an honest note when it dies ══════════════
{
  const { result } = await run('8a · crystallize outlives the global backstop', [TASK], happy, {
    args: { ...QUIET, agentTimeoutMin: 0.001 },
    crystallize: () => new Promise((r) => setTimeout(() => r(CRY_OK), 200)),
  })
  ok(!result.telemetry.timedOut.includes('crystallize') && result.harness && result.harness.crystallize, 'crystallize returned, past the 0.06 s global backstop')
  ok(/HARNESS LEARNED/.test(result.note), 'and the note reports what it learned')
}
{
  const { result } = await run('8b · a PR shipped but crystallize died → the note says so and how to finish', [TASK], happy, { args: QUIET, crystallize: null })
  ok(/crystallize did NOT finish/.test(result.note) && result.note.includes('https://github.com/x/y/pull/9'), 'the note names the PR to crystallize by hand')
  ok(!/no PR this run/.test(result.note), 'never "no PR this run" when a PR exists')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
