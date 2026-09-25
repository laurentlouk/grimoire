// ════════════════════════════════════════════════════════════════════════════
//  Plugin agent names + the tracker tool hint — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/agent-namespacing.test.mjs
//
//  Observed live (2026-09-25): installed as a plugin, grimoire's agents are registered as
//  `grimoire:<name>`, but the engine dispatched `agentType: 'reviewer'`. Every precheck and
//  reviewer died with "agent type 'reviewer' not found", review reported "all died", the loop
//  burned its replans and HALTed with finished, unreviewed work. Same run: the index agent
//  picked an unauthenticated tracker MCP by name although an authenticated connector with an
//  opaque server id was available, and the run refused to start.
//
//  What this locks down:
//    • reviewer · scouts · finalCheck default · plugin-shipped specialists dispatch as
//      `grimoire:<name>` by default; `agentNamespace: ''` keeps bare names (agents copied
//      into the project); a custom namespace is honoured
//    • repo/team agents and project-defined specialists are never namespaced; an already
//      qualified `other:thing` is left alone
//    • the selector's roster (schema enum, routing table, validation) uses the resolved names,
//      and a bare pick of a plugin specialist is normalized, not bounced to the owner
//    • memory stays keyed by the bare name (`agents/reviewer.md`, `agents/migration-engineer.md`)
//    • the engine's plugin-agent list matches agents/*.md
//    • `tracker` is pasted verbatim into every tracker-touching header (index · hydrate ·
//      claim · release · replan) and is absent when not configured
//
//  Same stubbed runtime as harness-v06.test.mjs.
import { readFileSync, readdirSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)

const REPOS = [
  { name: 'api', agent: 'backend-engineer', tags: ['backend'], gate: null },
  { name: 'mobile', agent: 'app-engineer', tags: ['mobile'], gate: null },
]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-600', repos: REPOS, telemetry: { enabled: false } }

const indexOf = (tasks) => ({
  slices: [{
    slice: 1,
    sliceLabel: 'v',
    issues: tasks.map((t) => ({ id: t.id, title: 't', repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })),
  }],
  hookProblems: [],
})

async function run(scenario, tasks, responder, extraArgs = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map((t) => ({ ...t })) } // copies: the engine mutates what it is handed
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
  return { result, calls, logs }
}

const API_TASK = { id: 'PROJ-1', ticket: 'PROJ-1', repo: 'api', agent: 'backend-engineer', model: 'sonnet', slice: 1, sliceLabel: 'v', order: 1, taskText: 'Build it', deferred: false, branch: 'feat/x', files: ['src/a.ts — add a'] }
const IMPL_OK = { status: 'DONE', summary: 's', commits: ['aaaaaaa'], baseSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const FIX_OK = { status: 'DONE', summary: 'fixed', commits: ['bbbbbbb'], headSha: 'bbbbbbb' }
const PASSV = { verdict: 'PASS', findings: [], summary: 'ok' }
const MAJOR = { verdict: 'FAIL', findings: [{ severity: 'major', file: 'src/a.ts', line: 3, issue: 'unhandled null' }], summary: 'fail' }
const EMPTY_CTX = { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
// One question per scout shape: contract · security · perf · codebase.
const QS = ['Which proto field carries the id?', 'Is the admin role checked before this handler?', 'Is this query on the hot path, what is its latency?', 'Where is the retry helper?']

// Drives one task through every dispatch that names a plugin agent: four NEEDS_CONTEXT
// scouts, precheck, the spec panel, a quality FAIL → verifier → fix → guard, and the
// configured final check.
function everyRungResponder() {
  let q = 0
  let spec = 0
  return (label) => {
    if (label === 'harness-context') return EMPTY_CTX
    if (label.startsWith('impl:')) return q < QS.length ? { status: 'NEEDS_CONTEXT', summary: 'q', question: QS[q++] } : IMPL_OK
    if (label.startsWith('resolve:')) return { answered: true, answer: 'x at a.ts:1' }
    if (label.startsWith('precheck:')) return { verdict: 'PASS', problems: [] }
    if (label.startsWith('break-it:')) return spec++ === 0 ? MAJOR : PASSV // a multi-lens quality stage, so the guard runs
    if (label.startsWith('verify:')) return { results: [{ index: 1, verdict: 'CONFIRMED' }] }
    if (label.startsWith('fix:')) return FIX_OK
    if (label.startsWith('guard:')) return { decision: 'PASS', reason: 'fixed at src/a.ts:3' }
    return PASSV
  }
}
const typeOf = (calls, prefix) => [...new Set(calls.filter((c) => c.label.startsWith(prefix)).map((c) => c.opts.agentType))]
const REVIEW_PREFIXES = ['precheck:', 'spec-hawk:', 'break-it:', 'verify:', 'guard:']

// ══════ 1 · default namespace: every plugin agent is dispatched as grimoire:<name> ══════
{
  const { calls, result } = await run('N1 · default: reviewer, scouts and the finalCheck default are grimoire:<name>', [API_TASK], everyRungResponder(),
    { maxContextResolves: 4, finalCheck: { repos: ['api'], prompt: 'Check the API contract.' } })
  ok(result.done.length === 1, 'the task landed (the run was not killed by unknown agent types)')
  for (const p of REVIEW_PREFIXES) eq(typeOf(calls, p), ['grimoire:reviewer'], `${p} dispatches as grimoire:reviewer`)
  const panel = calls.filter((c) => c.opts.schema && c.opts.phase && /review/i.test(c.opts.phase) && !c.label.startsWith('fix:'))
  eq([...new Set(panel.map((c) => c.opts.agentType))], ['grimoire:reviewer'], 'every review-phase dispatch is grimoire:reviewer')
  eq(calls.filter((c) => c.label.startsWith('resolve:')).map((c) => c.opts.agentType),
    ['grimoire:contract-checker', 'grimoire:security-scout', 'grimoire:perf-scout', 'grimoire:codebase-scout'], 'scouts are namespaced, in question-shape order')
  eq(typeOf(calls, 'contract-check'), ['grimoire:contract-checker'], 'the finalCheck default is grimoire:contract-checker')
  eq(typeOf(calls, 'impl:'), ['backend-engineer'], 'the repo owner stays un-namespaced')
  eq(typeOf(calls, 'fix:'), ['backend-engineer'], 'fix rounds go to the repo owner, un-namespaced')
  const reviewPrompt = calls.find((c) => c.label.startsWith('spec-hawk:')).prompt
  ok(reviewPrompt.includes('`memory/agents/reviewer.md`') && !reviewPrompt.includes('grimoire:reviewer.md'), 'reviewer memory stays at agents/reviewer.md')
  const loader = calls.find((c) => c.label === 'harness-context').prompt
  ok(loader.includes('for each of backend-engineer, app-engineer, reviewer,'), 'the memory loader is given bare agent names')
}

// ══════ 2 · agentNamespace: '' → bare names (agents copied into the project) ══════
{
  const { calls, result } = await run("N2 · agentNamespace '' keeps every name bare", [API_TASK], everyRungResponder(),
    { agentNamespace: '', maxContextResolves: 4, finalCheck: { repos: ['api'], prompt: 'Check the API contract.' } })
  ok(result.done.length === 1, 'the task landed')
  for (const p of REVIEW_PREFIXES) eq(typeOf(calls, p), ['reviewer'], `${p} dispatches as reviewer`)
  eq(calls.filter((c) => c.label.startsWith('resolve:')).map((c) => c.opts.agentType),
    ['contract-checker', 'security-scout', 'perf-scout', 'codebase-scout'], 'scouts are bare')
  eq(typeOf(calls, 'contract-check'), ['contract-checker'], 'the finalCheck default is bare')
}

// ══════ 3 · a custom namespace (the plugin installed under another name) ══════
{
  const { calls } = await run('N3 · agentNamespace acme → acme:<name>', [API_TASK], everyRungResponder(),
    { agentNamespace: 'acme', maxContextResolves: 4 })
  eq(typeOf(calls, 'spec-hawk:'), ['acme:reviewer'], 'reviewers are acme:reviewer')
  eq(calls.filter((c) => c.label.startsWith('resolve:')).map((c) => c.opts.agentType),
    ['acme:contract-checker', 'acme:security-scout', 'acme:perf-scout', 'acme:codebase-scout'], 'scouts are acme:<name>')
}

// ══════ 4 · specialists: plugin-shipped ones resolve, others are left alone ══════
{
  const SPECIALISTS = [
    { agent: 'migration-engineer', repos: ['api'], use: 'schema and data migrations' },
    { agent: 'other:thing', repos: ['api'], use: 'another plugin' },
    { agent: 'data-engineer', repos: ['api'], use: 'project-defined' },
  ]
  const MIG = { ...API_TASK, id: 'PROJ-1', agent: 'migration-engineer', files: ['src/a.ts'] } // the selector picked the bare name
  const OTHER = { ...API_TASK, id: 'PROJ-2', ticket: 'PROJ-2', agent: 'other:thing', files: ['src/b.ts'] }
  const DATA = { ...API_TASK, id: 'PROJ-3', ticket: 'PROJ-3', agent: 'data-engineer', files: ['src/c.ts'] }
  const APP = { ...API_TASK, id: 'PROJ-4', ticket: 'PROJ-4', repo: 'mobile', agent: 'app-engineer', files: ['app/x.tsx'] }
  const MEM = { harnessMemory: '', agentMemory: { 'migration-engineer': '- Backfills run in batches of 500 (2026-09-01).', reviewer: '- Reviewer fact.' }, priorLearnings: [], priorLedgers: [] }
  const { calls, result } = await run('S1 · specialist + repo agent resolution', [MIG, OTHER, DATA, APP], (label) => {
    if (label === 'harness-context') return MEM
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'ccccccc' }
    return PASSV
  }, { specialists: SPECIALISTS, precheck: false, verifyFindings: false, finalCheck: { repos: ['api'], prompt: 'x', agentType: 'other:thing' } })
  eq(typeOf(calls, 'impl:PROJ-1'), ['grimoire:migration-engineer'], 'a bare pick of a plugin specialist dispatches as grimoire:migration-engineer')
  eq(typeOf(calls, 'impl:PROJ-2'), ['other:thing'], 'an already-qualified specialist is untouched')
  eq(typeOf(calls, 'impl:PROJ-3'), ['data-engineer'], 'a project-defined specialist is untouched')
  eq(typeOf(calls, 'impl:PROJ-4'), ['app-engineer'], 'the repo agent app-engineer stays app-engineer')
  eq(result.routing.fallbacks, 0, 'no pick was bounced to the owner')
  eq(result.routing.byAgent, { 'grimoire:migration-engineer': 1, 'other:thing': 1, 'data-engineer': 1, 'app-engineer': 1 }, 'routing stats use the resolved names')
  const hyd = calls.find((c) => c.label.startsWith('hydrate:'))
  eq(hyd.opts.schema.properties.tasks.items.properties.agent.enum,
    ['backend-engineer', 'app-engineer', 'grimoire:migration-engineer', 'other:thing', 'data-engineer'], 'the roster the selector is validated against uses resolved names')
  ok(hyd.prompt.includes('- api → owner `backend-engineer` (checkout `repositories/api`); specialists: `grimoire:migration-engineer` (schema and data migrations), `other:thing` (another plugin), `data-engineer` (project-defined)'),
    'the routing table shows the resolved specialist names')
  const mig = calls.find((c) => c.label === 'impl:PROJ-1').prompt
  ok(mig.startsWith('## Your memory (`memory/agents/migration-engineer.md`') && mig.includes('- Backfills run in batches of 500 (2026-09-01).'), 'the specialist memory is keyed by its bare name')
  const loader = calls.find((c) => c.label === 'harness-context').prompt
  ok(loader.includes('for each of backend-engineer, app-engineer, migration-engineer, thing, data-engineer, reviewer,'), 'the loader reads bare memory file names')
  eq(typeOf(calls, 'contract-check'), ['other:thing'], 'a qualified finalCheck agentType is untouched')
}
{
  const { calls } = await run('S2 · a bare plugin finalCheck agentType is resolved', [API_TASK], (label) => {
    if (label === 'harness-context') return EMPTY_CTX
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { precheck: false, verifyFindings: false, finalCheck: { repos: ['api'], prompt: 'x', agentType: 'security-scout' } })
  eq(typeOf(calls, 'contract-check'), ['grimoire:security-scout'], 'finalCheck agentType security-scout → grimoire:security-scout')
}

// ══════ 5 · the engine's plugin-agent list is the agents/ directory ══════
{
  console.log('\n── D1 · PLUGIN_AGENTS matches agents/*.md')
  const m = body.match(/const PLUGIN_AGENTS = \[([^\]]*)\]/)
  const listed = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : null
  const shipped = readdirSync(`${ROOT}/agents`).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort()
  eq(listed, shipped, 'every shipped agent is known to the resolver, and nothing else')
}

// ══════ 6 · the tracker tool hint ══════
const TRACKER = { kind: 'linear', tools: 'mcp__055f8362-1877__*', note: 'the claude.ai Linear connector — authenticated' }
const HINT = [
  '## Tracker tools (configured for this run — use these, not a server picked by its name)',
  '- Kind: linear',
  '- Tools: `mcp__055f8362-1877__*` (load them with ToolSearch)',
  '- Note: the claude.ai Linear connector — authenticated',
].join('\n')
{
  // PROJ-7 sits behind PROJ-8, so hydration never sees it and the replan re-enters it (claim#);
  // PROJ-9 blocks on every attempt → release-claims at the end.
  const A = { ...API_TASK, id: 'PROJ-8', ticket: 'PROJ-8', files: ['src/h.ts'] }
  const B = { ...API_TASK, id: 'PROJ-7', ticket: 'PROJ-7', dependsOn: ['PROJ-8'], files: ['src/g.ts'] }
  const C = { ...API_TASK, id: 'PROJ-9', ticket: 'PROJ-9', repo: 'mobile', agent: 'app-engineer', files: ['app/z.tsx'] }
  let a = 0
  let rp = 0
  const responder = (label) => {
    if (label === 'harness-context') return EMPTY_CTX
    if (label === 'impl:PROJ-8') return a++ === 0 ? { status: 'BLOCKED', summary: 'x' } : IMPL_OK
    if (label === 'impl:PROJ-9') return { status: 'BLOCKED', summary: 'needs a human' }
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('replan')) return rp++ === 0
      ? { decision: 'REVISE', reason: 'split', learnings: [], tasks: [{ ...A, taskText: 'retry' }, { ...B, dependsOn: [] }] }
      : { decision: 'HALT', reason: 'needs a human', learnings: [] }
    if (label.startsWith('claim#')) return { released: ['PROJ-7'] }
    if (label === 'release-claims') return { released: ['PROJ-9'] }
    if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'ccccccc' }
    return PASSV
  }
  const TRACKER_LABELS = ['parse-index', 'hydrate:', 'claim#', 'replan#', 'release-claims']
  const base = { precheck: false, verifyFindings: false, claim: { identity: 'grimoire-bot' } }
  const withHint = await run('T1 · tracker set → its hint is in every tracker-touching header', [A, B, C], responder, { ...base, tracker: TRACKER })
  for (const p of TRACKER_LABELS) {
    const hits = withHint.calls.filter((c) => c.label.startsWith(p))
    ok(hits.length > 0 && hits.every((c) => c.prompt.includes(HINT)), `${p} carries the tracker hint verbatim (${hits.length} dispatch(es))`)
  }
  const nonTracker = withHint.calls.filter((c) => /^(impl|spec-hawk|integrate|ledger|crystallize|harness-context):?/.test(c.label))
  ok(nonTracker.length > 0 && nonTracker.every((c) => !c.prompt.includes('## Tracker tools')), 'dispatches that never touch the tracker do not carry it')

  a = 0; rp = 0
  const without = await run('T2 · tracker unset → no hint anywhere', [A, B, C], responder, base)
  for (const p of TRACKER_LABELS) {
    const hits = without.calls.filter((c) => c.label.startsWith(p))
    ok(hits.length > 0 && hits.every((c) => !c.prompt.includes('## Tracker tools')), `${p} has no tracker block`)
  }
}
{
  const { calls } = await run('T3 · a tracker without tools is ignored (nothing to point at)', [API_TASK], (label) => {
    if (label === 'harness-context') return EMPTY_CTX
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { precheck: false, verifyFindings: false, tracker: { kind: 'linear' } })
  ok(!calls.find((c) => c.label === 'parse-index').prompt.includes('## Tracker tools'), 'no block without a tools pattern')
}
{
  const { calls } = await run('T4 · kind and note are optional', [API_TASK], (label) => {
    if (label === 'harness-context') return EMPTY_CTX
    if (label.startsWith('impl:')) return IMPL_OK
    return PASSV
  }, { precheck: false, verifyFindings: false, tracker: { tools: 'mcp__abc__*' } })
  ok(calls.find((c) => c.label === 'parse-index').prompt.includes('## Tracker tools (configured for this run — use these, not a server picked by its name)\n- Tools: `mcp__abc__*` (load them with ToolSearch)\n\n'), 'only the tools line is written')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
