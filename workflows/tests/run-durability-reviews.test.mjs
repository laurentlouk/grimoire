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
//    • ONE WORKTREE PER REVIEWER — every review, verify, guard and sweep prompt carries a
//      "Running commands" block: a detached worktree at the reviewed head, named after the
//      dispatch, with the repo's laneSetup. The precheck (git reads only) gets none
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

console.log(`\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
