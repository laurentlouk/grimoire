// ════════════════════════════════════════════════════════════════════════════
//  Tests — economy/tools.mjs: which MCP servers each role loads and never uses (#54)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/economy/tools.test.mjs
//
//  What this locks down, over a fixture Claude dir of recorded loop runs:
//    • a role is (repo, agent type); the repo comes from the dispatch label and the journal
//    • loaded = the agent's prefix tools plus its deferred-tool deltas; used = the tools it called
//    • a server is a candidate when the role never used it and it was loaded over ≥ 10 dispatches
//      across ≥ 2 runs, or over ≥ 5 runs; the desktop app's own servers (ccd_*) always are
//    • a server the role used once never is; built-in tools are never servers; another role's use
//      does not protect it here
//    • each candidate carries its counts and the tokens its deferred names cost each dispatch
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serverOf, toolEvidence, nameTokens } from './tools.mjs'
import { writeAgent, writeWorkflow, slugOf } from './fixtures.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)
const section = (t) => console.log(`\n── ${t}`)

const ROOT = mkdtempSync(join(tmpdir(), 'grimoire-tools-'))
const CLAUDE = join(ROOT, 'claude')
const WS = '/ws/proj'
const line = (o) => JSON.stringify(o)
const call = (id, name) => line({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: `t-${id}`, name, input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } })
const delta = (added, removed = []) => line({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: added, removedNames: removed } })

// One recorded run: its journal (the events the attribution reads) and its agents' transcripts.
let wfN = 0
function writeRun(runId, agents) {
  const dir = writeWorkflow(join(CLAUDE, 'projects', slugOf(WS)), `s-${runId}`, `wf_${++wfN}`, runId)
  agents.forEach((a, i) => writeAgent(dir, `${runId}-${i}`, [delta(a.deferred || []), ...(a.removed ? [delta([], a.removed)] : []), ...(a.calls || []).map((c, j) => call(`${runId}-${i}-${j}`, c))],
    { agentType: a.type, description: a.label, model: 'sonnet' }, a.prefix || ['Bash', 'Read', 'Edit']))
  const tasks = [...new Set(agents.map((a) => /^impl:(.+)$/.exec(a.label)?.[1]).filter(Boolean))]
  return { runId, events: [{ type: 'run.start', repos: ['api', 'web'] }, ...tasks.map((t) => ({ type: 'dispatch', task: t, repo: t.startsWith('W') ? 'web' : 'api' }))] }
}

const FAL = ['mcp__fal-ai__run_model', 'mcp__fal-ai__search_models']
const CCD = ['mcp__ccd_session__mark_chapter', 'mcp__ccd_turn__update_plan']
const VERCEL = ['mcp__vercel__list_deployments']
const FIGMA = ['mcp__figma__get_screenshot']
const BROWSER = ['mcp__Claude_Browser__navigate']
const api = (task, extra = {}) => ({ type: 'backend-engineer', label: `impl:${task}`, prefix: ['Bash', 'Read', 'Edit', ...CCD], deferred: [...FAL, ...VERCEL, ...BROWSER], ...extra })
const web = (task, extra = {}) => ({ type: 'webapp-engineer', label: `impl:${task}`, prefix: ['Bash', 'Read'], deferred: [...BROWSER], calls: ['mcp__Claude_Browser__navigate', 'Bash'], ...extra })

const runs = [
  // two runs, 6 api dispatches each: fal never used (12 dispatches, 2 runs), vercel used once, browser unused in api
  writeRun('R1', [...[1, 2, 3, 4, 5].map((n) => api(`A${n}`)), api('A6', { calls: ['mcp__vercel__list_deployments', 'mcp__ccd_turn__update_plan'] }), web('W1'),
    { type: 'workflow-subagent', label: 'ship:api#1', deferred: FAL }]), // the Workflow tool's generic agent: no definition to deny tools on
  writeRun('R2', [...[7, 8, 9, 10, 11, 12].map((n) => api(`A${n}`)), web('W2')]),
  // figma: loaded in 3 dispatches of one run only, never used: too little evidence
  writeRun('R3', [1, 2, 3].map((n) => ({ type: 'test-engineer', label: `impl:T${n}`, deferred: FIGMA }))),
  // an agent the journal cannot place: no repo
  writeRun('R4', [{ type: 'grimoire:reviewer', label: 'spec-hawk:X1#1', deferred: FAL }]),
]
// linear: loaded once in each of 5 runs by a role that never used it → a candidate on runs alone;
// slack: added then removed by a later delta in each of those dispatches → never loaded, never a candidate
for (let i = 5; i <= 9; i++) runs.push(writeRun(`R${i}`, [{ type: 'infra-engineer', label: `impl:I${i}`, deferred: ['mcp__linear__get_issue', 'mcp__slack__send'], removed: ['mcp__slack__send'] }]))

try {
  section('servers')
  eq(['mcp__fal-ai__run_model', 'mcp__ccd_session__mark_chapter', 'mcp__plugin_grimoire_graph__graph_index', 'Bash', 'mcp__x', 'WebFetch'].map(serverOf),
    ['fal-ai', 'ccd_session', 'plugin_grimoire_graph', null, null, null], 'a server is the segment after mcp__; built-ins and malformed names have none')
  eq([nameTokens('mcp__fal-ai__run_model'), nameTokens('')], [7, 1], 'a deferred name costs about a token per 4 characters, plus its separator')

  section('evidence per role')
  const ev = toolEvidence(runs, { claudeDir: CLAUDE, roots: [WS] })
  eq(Object.keys(ev.roles).sort(), ['api/backend-engineer', 'api/infra-engineer', 'api/test-engineer', 'web/webapp-engineer'],
    'one role per (repo, agent type); a dispatch with no repo (a startup probe, a run-level agent) and the generic workflow-subagent are left out')
  const be = ev.roles['api/backend-engineer']
  eq([be.dispatches, be.runs], [12, 2], 'the backend role: 12 dispatches over 2 runs')
  eq(be.servers, {
    'Claude_Browser': { tools: 1, loadedDispatches: 12, loadedRuns: 2, used: false },
    'ccd_session': { tools: 1, loadedDispatches: 12, loadedRuns: 2, used: false },
    'ccd_turn': { tools: 1, loadedDispatches: 12, loadedRuns: 2, used: true },
    'fal-ai': { tools: 2, loadedDispatches: 12, loadedRuns: 2, used: false },
    'vercel': { tools: 1, loadedDispatches: 12, loadedRuns: 2, used: true },
  }, 'loaded from the prefix and the deferred deltas; used from the calls')
  eq(be.candidates, [
    { server: 'Claude_Browser', deny: 'mcp__Claude_Browser__*', tools: 1, loadedDispatches: 12, loadedRuns: 2, deferredNameTokens: 9, why: 'never used over 12 dispatches in 2 runs' },
    { server: 'ccd_session', deny: 'mcp__ccd_session__*', tools: 1, loadedDispatches: 12, loadedRuns: 2, deferredNameTokens: 0, why: "the desktop app's own tools" },
    { server: 'ccd_turn', deny: 'mcp__ccd_turn__*', tools: 1, loadedDispatches: 12, loadedRuns: 2, deferredNameTokens: 0, why: "the desktop app's own tools, called here though they act on the launching session" },
    { server: 'fal-ai', deny: 'mcp__fal-ai__*', tools: 2, loadedDispatches: 12, loadedRuns: 2, deferredNameTokens: 7 + 8, why: 'never used over 12 dispatches in 2 runs' },
  ], 'candidates: unused over ≥ 10 dispatches in ≥ 2 runs, and the desktop app\'s own servers even when called (it says so); vercel, used once, is not; sorted by server')
  eq(ev.roles['web/webapp-engineer'].candidates, [], 'the web role used the browser server: not a candidate there, though the api role never used it')
  eq(ev.roles['api/test-engineer'].candidates, [], 'figma over 3 dispatches of 1 run: too little evidence')
  eq(ev.roles['api/infra-engineer'].candidates.map((c) => [c.server, c.why]), [['linear', 'never used over 5 dispatches in 5 runs']], 'unused over 5 runs qualifies on runs alone')
  eq(Object.keys(ev.roles['api/infra-engineer'].servers), ['linear'], 'a deferred tool a later delta removed is not counted as loaded')
  eq(ev.runs, 9, 'the runs read')

  section('the team-agent template')
  const fm = (/^---\n([\s\S]*?)\n---/.exec(readFileSync(new URL('../../templates/team-agent.md', import.meta.url), 'utf8')) || [])[1] || ''
  const denied = ((/^disallowedTools: (.+)$/m.exec(fm) || [])[1] || '').split(', ')
  eq(denied, ['connectors', 'directory', 'host', 'pr', 'session', 'session_mgmt', 'settings', 'sidebar', 'turn', 'view', 'window'].map((s) => `mcp__ccd_${s}__*`),
    "the template withholds the desktop app's servers, one documented mcp__<server>__* entry each (no prefix wildcard)")
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
