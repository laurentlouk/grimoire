// grimoire · economy · tools: which MCP servers each role loads and never uses (token economy slice 8).
//
// Every dispatched agent is sent its loaded tools' schemas and the names of its deferred ones on
// each request, used or not. This reads the recorded runs offline (slice 1's transcript reader, no
// hook, no model): per role, a (repo, agent type), what each dispatch loaded (its .prefix.json
// tools plus its deferred-tool deltas) and what it called, grouped by MCP server. `crystallize`
// proposes `disallowedTools` entries on the role's definition from the candidates; nothing here
// changes any agent.
//
// The thresholds are adapted from microsoft/TokenEconomizer (tokeneconomizer/toolprune/stage.py and
// tools.py, commit 1deb887, Apache-2.0), with "sessions" read as dispatches: a server is a candidate
// when the role never used it and loaded it over ≥ 10 dispatches across ≥ 2 runs, or over ≥ 5
// runs. Built-in tools (its protected work surface and the rest) are never candidates: only MCP
// servers are. The desktop app's own servers (`ccd_*`) are always candidates once loaded, even when
// a dispatch called them (the candidate says so): they act on the launching session's panes, not on
// a dispatched agent's work (spec D8).
//
// A role is a role only when a definition can carry the denial: a dispatch the journal places in no
// repo (a startup probe, a run-level agent) and the Workflow tool's generic `workflow-subagent` are
// left out. A probe loads the role's tools and calls none, which would read as "never used".
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { readAgent } from './transcript.mjs'
import { findRunWorkflows, labelContext, attributeIn } from './runs.mjs'

export const MIN_DISPATCHES = 10
export const MIN_RUNS_WITH_DISPATCHES = 2
export const MIN_RUNS = 5
const DESKTOP_APP = /^ccd_/
const GENERIC_AGENT = 'workflow-subagent'

/** The MCP server a tool belongs to (`mcp__<server>__<tool>`), else null (a built-in tool). */
export function serverOf(tool) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(tool ?? ''))
  return m ? m[1] : null
}

/** About how many tokens a deferred tool's name costs in an agent's context: a token per 4 characters, plus its separator. */
export const nameTokens = (name) => Math.ceil(String(name ?? '').length / 4) + 1

const files = (p) => { try { return readdirSync(p).filter((f) => /^agent-.*\.jsonl$/.test(f)).sort() } catch { return [] } }

/**
 * Tool evidence over `runs` (each `{runId, events}`, as render-logs' loadRuns gives them): per role,
 * `{dispatches, runs, servers: {<server>: {tools, loadedDispatches, loadedRuns, used}}, candidates}`.
 * A candidate is `{server, deny: 'mcp__<server>__*', tools, loadedDispatches, loadedRuns,
 * deferredNameTokens, why}`; `deferredNameTokens` is what its deferred names cost each dispatch.
 */
export function toolEvidence(runs, opts = {}) {
  const roles = {}
  let read = 0
  for (const run of runs) {
    const workflows = findRunWorkflows(run.runId, opts)
    if (!workflows.length) continue
    read++
    const ctx = labelContext(run.events)
    for (const wf of workflows) {
      for (const f of files(wf.agentsDir)) {
        const a = readAgent(join(wf.agentsDir, f), { skipResults: true })
        if (!a.meta || !a.meta.agentType || a.meta.agentType === GENERIC_AGENT) continue
        const repo = attributeIn(a.meta.label, ctx).repo
        if (!repo) continue
        const role = (roles[`${repo}/${a.meta.agentType}`] ||= { dispatches: 0, runs: new Set(), servers: {} })
        role.dispatches++
        role.runs.add(run.runId)
        const loaded = new Set([...a.tools.loaded, ...a.tools.deferred])
        const used = new Set(a.calls.map((c) => c.name))
        const deferred = new Set(a.tools.deferred)
        const seen = new Set()
        for (const tool of loaded) {
          const server = serverOf(tool)
          if (!server) continue
          const s = (role.servers[server] ||= { tools: new Set(), deferred: new Set(), loadedDispatches: 0, loadedRuns: new Set(), used: false })
          s.tools.add(tool)
          if (deferred.has(tool)) s.deferred.add(tool)
          if (!seen.has(server)) { seen.add(server); s.loadedDispatches++; s.loadedRuns.add(run.runId) }
        }
        for (const tool of used) {
          const server = serverOf(tool)
          if (server) (role.servers[server] ||= { tools: new Set(), deferred: new Set(), loadedDispatches: 0, loadedRuns: new Set(), used: false }).used = true
        }
      }
    }
  }
  const out = {}
  for (const key of Object.keys(roles).sort()) {
    const r = roles[key]
    const servers = {}, candidates = []
    for (const name of Object.keys(r.servers).sort()) {
      const s = r.servers[name]
      servers[name] = { tools: s.tools.size, loadedDispatches: s.loadedDispatches, loadedRuns: s.loadedRuns.size, used: s.used }
      const desktop = DESKTOP_APP.test(name)
      if (!s.loadedDispatches || (s.used && !desktop)) continue
      const enough = (s.loadedDispatches >= MIN_DISPATCHES && s.loadedRuns.size >= MIN_RUNS_WITH_DISPATCHES) || s.loadedRuns.size >= MIN_RUNS
      if (!enough && !desktop) continue
      candidates.push({
        server: name, deny: `mcp__${name}__*`, tools: s.tools.size, loadedDispatches: s.loadedDispatches, loadedRuns: s.loadedRuns.size,
        deferredNameTokens: [...s.deferred].reduce((n, t) => n + nameTokens(t), 0),
        why: desktop ? `the desktop app's own tools${s.used ? ', called here though they act on the launching session' : ''}` : `never used over ${s.loadedDispatches} dispatches in ${s.loadedRuns.size} runs`,
      })
    }
    out[key] = { dispatches: r.dispatches, runs: r.runs.size, servers, candidates }
  }
  return { runs: read, roles: out }
}
