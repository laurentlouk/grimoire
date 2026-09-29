// ════════════════════════════════════════════════════════════════════════════
//  Loop-integrity regressions (0.8.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/loop-integrity-v08.test.mjs
//
//  Grounded in a real unattended run whose journal showed each of these defects:
//    • DIRECT TASKS OFF THE RUN BRANCH — a lone task committed on its tracker branch, so it
//      "landed" without ever reaching the run branch its dependents and the gate build on
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

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
