// grimoire · economy · transcript: one Claude Code transcript (a session's .jsonl, or a subagent's
// agent-<id>.jsonl) read into calls, usage and the model, plus, for a subagent, its meta (agent
// type, the dispatch label, model, workflow phase) and the tools it loaded. Read-only, never throws.
//
// The traps, adapted from microsoft/TokenEconomizer (tokeneconomizer/trace/claude.py, commit
// 1deb887, Apache-2.0):
//   • a message is written once per content block and each line repeats its usage: count it once
//     per message id, keeping the last line (its usage is the final one);
//   • `api-request-blob` lines replay earlier calls and usage: only assistant and user lines count;
//   • a tool_result's content may be a list of text items: join them;
//   • cache writes carry a TTL split (cache_creation.ephemeral_5m/1h_input_tokens); without it, they
//     are 5-minute writes.
import { readFileSync } from 'node:fs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (Number.isFinite(v) ? v : 0)
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : '')).filter(Boolean).join(' ') : '')

/** {calls, usage, model, badLines} of one transcript file; a missing file reads as empty. */
export function readTranscript(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch {}
  const usageById = new Map()
  const modelById = new Map()
  const calls = []
  const byToolId = new Map()
  const deferred = []
  let badLines = 0, anon = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { badLines++; continue }
    if (!isObj(e)) { badLines++; continue }
    if (e.type === 'attachment' && isObj(e.attachment) && e.attachment.type === 'deferred_tools_delta') {
      deferred.push(e.attachment)
      continue
    }
    if (e.type !== 'assistant' && e.type !== 'user') continue
    const m = isObj(e.message) ? e.message : {}
    if (e.type === 'assistant') {
      const id = typeof m.id === 'string' && m.id ? m.id : `anon-${anon++}`
      if (isObj(m.usage)) usageById.set(id, m.usage)
      if (typeof m.model === 'string' && m.model && m.model !== '<synthetic>') modelById.set(id, m.model)
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!isObj(b)) continue
      if (e.type === 'assistant' && b.type === 'tool_use' && typeof b.id === 'string' && !byToolId.has(b.id)) {
        const call = { name: String(b.name ?? ''), input: isObj(b.input) ? b.input : {}, result: '', ok: true, cwd: typeof e.cwd === 'string' ? e.cwd : null }
        byToolId.set(b.id, call)
        calls.push(call)
      } else if (e.type === 'user' && b.type === 'tool_result' && byToolId.has(b.tool_use_id)) {
        const call = byToolId.get(b.tool_use_id)
        call.result = resultText(b.content)
        call.ok = b.is_error !== true
      }
    }
  }
  const usage = { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, requests: usageById.size }
  for (const u of usageById.values()) {
    usage.input += num(u.input_tokens)
    usage.cacheRead += num(u.cache_read_input_tokens)
    const split = isObj(u.cache_creation) ? u.cache_creation : null
    if (split) {
      usage.cacheWrite5m += num(split.ephemeral_5m_input_tokens)
      usage.cacheWrite1h += num(split.ephemeral_1h_input_tokens)
    } else usage.cacheWrite5m += num(u.cache_creation_input_tokens)
    usage.output += num(u.output_tokens)
  }
  const counts = new Map()
  for (const md of modelById.values()) counts.set(md, (counts.get(md) || 0) + 1)
  let model = null, best = 0
  for (const [md, c] of counts) if (c > best) { model = md; best = c }
  return { calls, usage, model, badLines, deferredDeltas: deferred }
}

/** A subagent transcript plus its .meta.json (label = the dispatch description) and loaded tools. */
export function readAgent(jsonlFile) {
  const t = readTranscript(jsonlFile)
  const base = jsonlFile.replace(/\.jsonl$/, '')
  const m = readJson(`${base}.meta.json`)
  const meta = isObj(m)
    ? { agentType: m.agentType ?? null, label: m.description ?? null, model: m.model ?? null, workflowPhase: m.workflowPhase ?? null }
    : null
  const p = readJson(`${base}.prefix.json`)
  const loaded = isObj(p) && isObj(p.state) && Array.isArray(p.state.toolNames) ? p.state.toolNames.map(String) : []
  const deferred = []
  for (const d of t.deferredDeltas) {
    for (const n of Array.isArray(d.addedNames) ? d.addedNames : []) if (!deferred.includes(n)) deferred.push(n)
    for (const n of Array.isArray(d.removedNames) ? d.removedNames : []) { const i = deferred.indexOf(n); if (i >= 0) deferred.splice(i, 1) }
  }
  const { deferredDeltas, ...rest } = t
  return { ...rest, meta, tools: { loaded, deferred } }
}
