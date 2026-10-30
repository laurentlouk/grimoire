// Test fixtures for the economy scripts: a fake Claude Code config dir holding one loop run's
// workflow files and agent transcripts, in the layout Claude Code writes them:
//   projects/<cwd slug>/<session>/workflows/wf_<id>.json        (args.runId = grimoire's runId)
//   projects/<cwd slug>/<session>/subagents/workflows/wf_<id>/agent-<id>.jsonl + .meta.json + .prefix.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const line = (o) => JSON.stringify(o)
const usage = (input, read, write, out, split) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, ...(split ? { cache_creation: split } : {}), output_tokens: out })

// One implementer's transcript, with every trap the reader must handle. Hand-computed totals:
// input 16 · cache read 3000 · cache write 5 min 300 · cache write 1 h 300 · output 84 · 3 requests
// effective = 16 + 3000·0.10 + 300·1.25 + 300·2 + 84·5 = 1711
export const IMPL_EFFECTIVE = 1711
export const IMPL_LINES = [
  // message m1 is written once per content block, each line repeating its usage
  line({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'running the tests' }], usage: usage(10, 1000, 200, 50, { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 }) } }),
  line({ type: 'assistant', cwd: '/w/api', message: { id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rtk npm test' } }], usage: usage(10, 1000, 200, 50, { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 }) } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'FAIL a' }, { type: 'text', text: '2 failing' }] }] } }),
  // a request blob replays earlier calls and usage: never read
  line({ type: 'api-request-blob', message: { id: 'm1', content: [{ type: 'tool_use', id: 't9', name: 'Write', input: {} }], usage: usage(99999, 0, 0, 99999) } }),
  // m2: no TTL split (an older Claude Code) → 5-minute writes; its second line carries the final usage
  line({ type: 'assistant', cwd: '/w/api', message: { id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a.ts' } }], usage: usage(5, 2000, 100, 20) } }),
  line({ type: 'assistant', message: { id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'read it' }], usage: usage(5, 2000, 100, 30) } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'file body' }] } }),
  line({ type: 'assistant', message: { id: 'm3', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'ok' }], usage: usage(1, 0, 300, 4, { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 300 }) } }),
  line({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__x__a', 'mcp__x__b', 'WebFetch'], removedNames: [] } }),
  line({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: [], removedNames: ['mcp__x__b'] } }),
  'not json',
]

// A short mechanical dispatch: 1 request, haiku. effective = 2 + 0 + 4000·1.25 + 10·5 = 5052
export const JOURNAL_EFFECTIVE = 5052
export const JOURNAL_LINES = [
  line({ type: 'assistant', message: { id: 'j1', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'ok' }], usage: usage(2, 0, 4000, 10) } }),
]

// A review persona on opus. effective = 3 + 500·0.10 + 0 + 0 + 100·5 = 553
export const REVIEW_EFFECTIVE = 553
export const REVIEW_LINES = [
  line({ type: 'assistant', message: { id: 'r1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'PASS' }], usage: usage(3, 500, 0, 100) } }),
]

/** Claude Code's project dir name for a working directory: every non-alphanumeric becomes '-'. */
export const slugOf = (p) => p.replace(/[^A-Za-z0-9]/g, '-')

export function writeAgent(dir, id, lines, meta, prefixTools) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `agent-${id}.jsonl`), lines.join('\n') + '\n')
  if (meta) writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify(meta))
  if (prefixTools) writeFileSync(join(dir, `agent-${id}.prefix.json`), JSON.stringify({ v: 1, state: { toolNames: prefixTools } }))
}

export function writeWorkflow(projectDir, session, wfId, runId, extra = {}) {
  const d = join(projectDir, session, 'workflows')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, `${wfId}.json`), JSON.stringify({ runId: wfId, script: '/* the engine */', args: { execute: true, runId }, defaultModel: 'claude-opus-5-5', ...extra }))
  return join(projectDir, session, 'subagents', 'workflows', wfId)
}

/**
 * A Claude dir for grimoire run `runId` launched from `root`: two sessions (the second a resume),
 * plus a run of another runId that must be ignored, and a malformed workflow file.
 *   session s1 · wf_1: impl:T1 (the trap-laden transcript), journal#1, spec-hawk:T1
 *   session s2 · wf_3: fix:T1:spec#1 (the review transcript's usage, sonnet meta), an agent with no meta
 */
export function writeClaudeRun(claudeDir, root, runId) {
  const project = join(claudeDir, 'projects', slugOf(root))
  const a1 = writeWorkflow(project, 's1', 'wf_1', runId)
  writeAgent(a1, 'a1', IMPL_LINES, { agentType: 'backend-engineer', description: 'impl:T1', model: 'sonnet', workflowPhase: 'Implement' }, ['Bash', 'Read', 'Edit', 'mcp__ccd_session__mark_chapter'])
  writeAgent(a1, 'a2', JOURNAL_LINES, { agentType: 'workflow-subagent', description: 'journal#1', model: 'haiku', workflowPhase: 'Implement' })
  writeAgent(a1, 'a3', REVIEW_LINES, { agentType: 'grimoire:reviewer', description: 'spec-hawk:T1#1', model: 'opus', workflowPhase: 'Spec review' })
  const a3 = writeWorkflow(project, 's2', 'wf_3', runId)
  writeAgent(a3, 'a4', REVIEW_LINES, { agentType: 'backend-engineer', description: 'fix:T1:spec#1', model: 'sonnet', workflowPhase: 'Implement' })
  writeAgent(a3, 'a5', JOURNAL_LINES, null)
  const other = writeWorkflow(project, 's3', 'wf_2', 'another-run')
  writeAgent(other, 'b1', IMPL_LINES, { agentType: 'backend-engineer', description: 'impl:T9', model: 'sonnet' })
  mkdirSync(join(project, 's4', 'workflows'), { recursive: true })
  writeFileSync(join(project, 's4', 'workflows', 'wf_bad.json'), '{ not json')
  return project
}
