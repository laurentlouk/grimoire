// grimoire · economy · runs: what one loop run really cost, read from Claude Code's transcripts.
//
// A loop run is a Workflow. Claude Code keeps, per session, one file per workflow launch and one
// transcript per agent it dispatched:
//   <claude dir>/projects/<cwd slug>/<session>/workflows/wf_<id>.json           args.runId = grimoire's runId
//   <claude dir>/projects/<cwd slug>/<session>/subagents/workflows/wf_<id>/agent-<id>.jsonl
//                                                  + agent-<id>.meta.json      description = the agent() label
// A resumed run has one workflow file per session, all with the same args.runId. The launching
// session's cwd is the workspace root, the main checkout or one of its worktrees, so the project
// dirs read are the roots' own and those nested under them (worktrees in .claude/worktrees/…).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readAgent } from './transcript.mjs'
import { price, tierOf } from './pricing.mjs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() } catch { return [] } }
const files = (p, re) => { try { return readdirSync(p).filter((f) => re.test(f)).sort() } catch { return [] } }

/** Claude Code's config dir: the override, else $CLAUDE_CONFIG_DIR, else ~/.claude. */
export const claudeDir = (override) => override || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

/** Claude Code's project dir name for a working directory: every non-alphanumeric becomes '-'. */
export const projectSlug = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-')

/** Every workflow launch with a grimoire runId, from the roots' project dirs and those nested under them. */
export function scanWorkflows({ claudeDir: dir, roots = [] } = {}) {
  const projects = join(claudeDir(dir), 'projects')
  const slugs = roots.map(projectSlug)
  const out = []
  for (const name of dirs(projects)) {
    if (!slugs.some((s) => name === s || name.startsWith(`${s}-`))) continue
    const projectDir = join(projects, name)
    for (const session of dirs(projectDir)) {
      const wfDir = join(projectDir, session, 'workflows')
      for (const f of files(wfDir, /^wf_.*\.json$/)) {
        let j
        try { j = JSON.parse(readFileSync(join(wfDir, f), 'utf8')) } catch { continue }
        if (!isObj(j) || !isObj(j.args) || typeof j.args.runId !== 'string' || !j.args.runId) continue
        const wfId = typeof j.runId === 'string' && j.runId ? j.runId : f.replace(/\.json$/, '')
        out.push({ runId: j.args.runId, wfId, session, projectDir, file: join(wfDir, f), agentsDir: join(projectDir, session, 'subagents', 'workflows', wfId),
          startTime: Number.isFinite(j.startTime) ? j.startTime : null, defaultModel: typeof j.defaultModel === 'string' ? j.defaultModel : null })
      }
    }
  }
  return out
}

/** runId → its workflow launches: scan once, then bill many runs from it (`runBill(id, {index})`). */
export function indexWorkflows(opts = {}) {
  const index = new Map()
  for (const w of scanWorkflows(opts)) { if (!index.has(w.runId)) index.set(w.runId, []); index.get(w.runId).push(w) }
  return index
}

/** The workflow launches of grimoire run `runId`: every session of it, a resumed run's included. */
export function findRunWorkflows(runId, opts = {}) {
  return opts.index ? opts.index.get(runId) || [] : scanWorkflows(opts).filter((w) => w.runId === runId)
}

const zero = () => ({ input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, requests: 0 })
const addUsage = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k] || 0; return a }

/** One bill per dispatched agent of the run, and the run's total, in effective tokens. */
export function runBill(runId, opts = {}) {
  const workflows = findRunWorkflows(runId, opts)
  const dispatches = []
  const total = { usage: zero(), effective: 0 }
  for (const wf of workflows) {
    for (const f of files(wf.agentsDir, /^agent-.*\.jsonl$/)) {
      const a = readAgent(join(wf.agentsDir, f))
      const model = a.model ?? null
      const p = price(a.usage, model ?? (a.meta && a.meta.model))
      dispatches.push({
        label: a.meta ? a.meta.label : null, agentType: a.meta ? a.meta.agentType : null, workflowPhase: a.meta ? a.meta.workflowPhase : null,
        model, tier: tierOf(model ?? (a.meta && a.meta.model)), wfId: wf.wfId, session: wf.session,
        usage: a.usage, effective: p.effective, pricedBy: p.pricedBy,
      })
      addUsage(total.usage, a.usage)
      total.effective = Math.round((total.effective + p.effective) * 100) / 100
    }
  }
  return { runId, workflows: workflows.map((w) => w.wfId), dispatches, total }
}

// The engine's own dispatch kinds; any other label prefix is a review persona (a lens).
export const ENGINE_KINDS = new Set(['impl', 'fix', 'precheck', 'verify', 'guard', 'integrate', 'resolve', 'hydrate', 'env', 'ship', 'seal', 'gate',
  'journal', 'status', 'claim', 'replan', 'preflight', 'parse-index', 'harness-context', 'ledger', 'crystallize', 'contract-check', 'release-claims', 'agent'])

/**
 * A dispatch label's kind, task, repo and lens, given the run's task ids and repo names. Labels are
 * `<kind>[:<rest>]` with suffixes the engine appends (`#<n>`, `~r<n>`, `+ctx<n>`, `:<stage>`); the
 * rest is shortened one suffix at a time until it names a task, a `<repo>:final` slot or a repo.
 * Task ids may hold `#` themselves (`#5`), so a suffix is dropped only when the whole rest fails.
 */
export function attribute(label, { tasks = new Set(), repos = new Set() } = {}) {
  const none = { kind: 'unknown', task: null, repo: null, lens: null }
  if (typeof label !== 'string' || !label) return none
  const m = /^([^:#~+]+)(?::(.*))?/.exec(label)
  if (!m) return none
  const kind = m[1]
  const lens = ENGINE_KINDS.has(kind) ? null : kind
  let rest = m[2] ?? ''
  while (rest) {
    if (tasks.has(rest)) return { kind, task: rest, repo: (/^(.+):final$/.exec(rest) || [])[1] ?? null, lens }
    const fin = /^(.+):final$/.exec(rest)
    if (fin && repos.has(fin[1])) return { kind, task: rest, repo: fin[1], lens }
    if (repos.has(rest)) return { kind, task: null, repo: rest, lens }
    const shorter = rest.replace(/(?:#[^#:~+]*|~[^#:~+]*|\+[^#:~+]*|:[^:]*)$/, '')
    if (shorter === rest) break
    rest = shorter
  }
  return { kind, task: null, repo: null, lens }
}
