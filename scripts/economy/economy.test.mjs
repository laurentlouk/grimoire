// ════════════════════════════════════════════════════════════════════════════
//  Tests — scripts/economy: the transcript reader, pricing, and a run's bill
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/economy/economy.test.mjs
//
//  What this locks down:
//    • usage is counted once per message id (the transcript repeats it per content block, the
//      last line wins), request blobs are never read, unparseable lines are skipped
//    • cache writes are split by TTL (5 min at 1.25, 1 h at 2.0); with no split they are 5 min
//    • calls pair tool_use with tool_result (a list result joined, is_error → not ok, the cwd kept)
//    • the loaded tools come from prefix.json and the deferred-tool deltas, in order
//    • an unknown or missing model is priced on the Claude weights and labelled fallback
//    • a run's bill gathers every workflow file whose args.runId is the run (a resumed run has
//      several sessions), from the checkout's project dir and its nested worktrees, and ignores
//      other runs and malformed files
//    • a dispatch label is attributed to its kind, task, repo and review lens
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTranscript, readAgent } from './transcript.mjs'
import { price, tierOf, WEIGHTS } from './pricing.mjs'
import { projectSlug, claudeDir, findRunWorkflows, runBill, attribute } from './runs.mjs'
import { IMPL_LINES, IMPL_EFFECTIVE, JOURNAL_EFFECTIVE, REVIEW_EFFECTIVE, writeAgent, writeClaudeRun, writeWorkflow, slugOf } from './fixtures.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)
const section = (t) => console.log(`\n── ${t}`)

const ROOT = mkdtempSync(join(tmpdir(), 'grimoire-economy-'))
try {
  section('transcript: usage, calls, tools')
  const dir = join(ROOT, 'agents')
  writeAgent(dir, 'a1', IMPL_LINES, { agentType: 'backend-engineer', description: 'impl:T1', model: 'sonnet', workflowPhase: 'Implement' }, ['Bash', 'Read'])
  const t = readTranscript(join(dir, 'agent-a1.jsonl'))
  eq(t.usage, { input: 16, cacheRead: 3000, cacheWrite5m: 300, cacheWrite1h: 300, output: 84, requests: 3 }, 'usage: once per message id, last line wins, blobs ignored, TTL split, no split → 5 min')
  eq(t.model, 'claude-sonnet-5-5', 'model: the most frequent across messages')
  eq(t.calls, [
    { name: 'Bash', input: { command: 'rtk npm test' }, result: 'FAIL a 2 failing', ok: false, cwd: '/w/api' },
    { name: 'Read', input: { file_path: 'a.ts' }, result: 'file body', ok: true, cwd: '/w/api' },
  ], 'calls: paired with results, a list result joined, is_error → not ok, the blob\'s call ignored')
  eq(t.badLines, 1, 'an unparseable line is counted, not fatal')
  const a = readAgent(join(dir, 'agent-a1.jsonl'))
  eq(a.meta, { agentType: 'backend-engineer', label: 'impl:T1', model: 'sonnet', workflowPhase: 'Implement' }, 'agent meta: the label is the dispatch description')
  eq(a.tools, { loaded: ['Bash', 'Read'], deferred: ['mcp__x__a', 'WebFetch'] }, 'tools: prefix.json and the deferred deltas applied in order')
  writeAgent(dir, 'bare', ['{"type":"assistant","message":{"id":"x","content":[]}}'], null)
  const bare = readAgent(join(dir, 'agent-bare.jsonl'))
  eq([bare.meta, bare.tools, bare.usage.requests, bare.model], [null, { loaded: [], deferred: [] }, 0, null], 'no meta, no prefix, no usage, no model: empty, never an error (a message without usage is no billed request)')
  eq(readTranscript(join(dir, 'missing.jsonl')).usage.requests, 0, 'a missing file reads as empty')

  section('pricing')
  eq(WEIGHTS, { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2, output: 5 }, 'weights relative to fresh input')
  eq(price(t.usage, t.model), { effective: IMPL_EFFECTIVE, pricedBy: 'claude' }, 'effective tokens of the fixture transcript')
  eq(price(t.usage, 'gpt-5.6-sol'), { effective: IMPL_EFFECTIVE, pricedBy: 'fallback' }, 'an unknown model: Claude weights, labelled fallback')
  eq(price(t.usage, null).pricedBy, 'fallback', 'a missing model is labelled fallback')
  eq(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'opus', 'gpt-5.6-sol', null].map(tierOf), ['opus', 'sonnet', 'haiku', 'opus', 'other', 'unknown'], 'tiers')

  section('a run\'s bill')
  eq(projectSlug('/Users/a/b.c/.claude/worktrees/x_y'), '-Users-a-b-c--claude-worktrees-x-y', 'project slug: every non-alphanumeric is -')
  eq(claudeDir('/x'), '/x', 'an explicit claude dir wins')
  const CLAUDE = join(ROOT, 'claude')
  const WS = '/ws/proj'
  writeClaudeRun(CLAUDE, WS, 'R1')
  // a nested worktree of the checkout holds a third session of the same run
  const wt = writeWorkflow(join(CLAUDE, 'projects', slugOf(`${WS}/.claude/worktrees/feat`)), 's9', 'wf_9', 'R1')
  writeAgent(wt, 'w1', ['{"type":"assistant","message":{"id":"w","model":"claude-haiku-5-5","content":[],"usage":{"input_tokens":7,"output_tokens":0}}}'], { agentType: 'workflow-subagent', description: 'env:stall#1', model: 'haiku' })
  // an unrelated checkout whose name starts like it must not be read
  const near = writeWorkflow(join(CLAUDE, 'projects', slugOf('/ws/project2')), 's8', 'wf_8', 'R1')
  writeAgent(near, 'n1', IMPL_LINES, { agentType: 'x', description: 'impl:T1', model: 'sonnet' })
  const wfs = findRunWorkflows('R1', { claudeDir: CLAUDE, roots: [WS] })
  eq(wfs.map((w) => w.wfId).sort(), ['wf_1', 'wf_3', 'wf_9'], 'every session of the run, its worktrees included; other runs, look-alike checkouts and malformed files ignored')
  const bill = runBill('R1', { claudeDir: CLAUDE, roots: [WS] })
  const byLabel = Object.fromEntries(bill.dispatches.map((d) => [d.label ?? '(none)', d]))
  eq(Object.keys(byLabel).sort(), ['(none)', 'env:stall#1', 'fix:T1:spec#1', 'impl:T1', 'journal#1', 'spec-hawk:T1#1'], 'one dispatch per agent transcript')
  eq([byLabel['impl:T1'].effective, byLabel['impl:T1'].tier, byLabel['impl:T1'].agentType], [IMPL_EFFECTIVE, 'sonnet', 'backend-engineer'], 'a dispatch: effective tokens, tier from its messages, agent type')
  eq([byLabel['journal#1'].effective, byLabel['spec-hawk:T1#1'].effective, byLabel['fix:T1:spec#1'].tier], [JOURNAL_EFFECTIVE, REVIEW_EFFECTIVE, 'opus'], 'each dispatch priced on its own transcript')
  eq(bill.total.effective, IMPL_EFFECTIVE + JOURNAL_EFFECTIVE * 2 + REVIEW_EFFECTIVE * 2 + 7, 'the run total sums every dispatch of every session')
  eq(bill.total.usage.output, 84 + 10 * 2 + 100 * 2, 'and its usage')
  eq(runBill('nope', { claudeDir: CLAUDE, roots: [WS] }), { runId: 'nope', workflows: [], dispatches: [], total: { usage: { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, requests: 0 }, effective: 0 } }, 'a run with no transcripts: an empty bill')
  eq(runBill('R1', { claudeDir: join(ROOT, 'no-such-dir'), roots: [WS] }).dispatches, [], 'a missing claude dir: an empty bill')

  section('attribution')
  const ctx = { tasks: new Set(['T1', 'api:final']), repos: new Set(['api']) }
  const at = (l) => attribute(l, ctx)
  eq(at('impl:T1'), { kind: 'impl', task: 'T1', repo: null, lens: null }, 'impl')
  eq(at('impl:T1+ctx1'), { kind: 'impl', task: 'T1', repo: null, lens: null }, 'a context resume of impl')
  eq(at('fix:T1:spec#2'), { kind: 'fix', task: 'T1', repo: null, lens: null }, 'fix: the stage is dropped to find the task')
  eq(at('precheck:T1#2~r1'), { kind: 'precheck', task: 'T1', repo: null, lens: null }, 'suffixes # and ~ are dropped')
  eq(at('spec-hawk:T1#1'), { kind: 'spec-hawk', task: 'T1', repo: null, lens: 'spec-hawk' }, 'a review persona is its lens')
  eq(at('reliability-sre:api:final'), { kind: 'reliability-sre', task: 'api:final', repo: 'api', lens: 'reliability-sre' }, 'a terminal persona: the <repo>:final slot and its repo')
  eq(at('ship:api#3'), { kind: 'ship', task: null, repo: 'api', lens: null }, 'ship: the repo')
  eq(at('gate:api'), { kind: 'gate', task: null, repo: 'api', lens: null }, 'gate: the repo')
  eq(at('journal#4'), { kind: 'journal', task: null, repo: null, lens: null }, 'journal')
  eq(at('preflight:grimoire:reviewer'), { kind: 'preflight', task: null, repo: null, lens: null }, 'preflight is an engine kind, not a lens')
  eq(at(null), { kind: 'unknown', task: null, repo: null, lens: null }, 'no label')
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
