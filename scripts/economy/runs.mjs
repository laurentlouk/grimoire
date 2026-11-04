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
//
//   node scripts/economy/runs.mjs cost --run <runId> [--kind <kind>] [--root <dir>] [--claude-dir <dir>]
//     → `COST <effective tokens>` for every session of the run so far (a resumed run's included), or
//       for its dispatches of one kind only (`--kind stuck-judge`: what the stuck judges cost),
//       read from the project dirs of <root> (default: the cwd) and of its git worktrees; `COST
//       none` when no workflow of that runId is found. The loop's journal script runs it after each
//       write when maxCost is set (token economy slice 2). Exit 2 on a usage error only.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { readAgent } from './transcript.mjs'
import { price, tierOf } from './pricing.mjs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// a symlink to a directory counts as one (a project or session dir linked from elsewhere)
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() || (d.isSymbolicLink() && isDir(join(p, d.name)))).map((d) => d.name).sort() } catch { return [] } }
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
  const seen = new Set() // real paths: a project dir linked under two matching names is read once
  for (const name of dirs(projects)) {
    if (!slugs.some((s) => name === s || name.startsWith(`${s}-`))) continue
    const projectDir = join(projects, name)
    for (const session of dirs(projectDir)) {
      const wfDir = join(projectDir, session, 'workflows')
      for (const f of files(wfDir, /^wf_.*\.json$/)) {
        let real = join(wfDir, f)
        try { real = realpathSync(real) } catch {}
        if (seen.has(real)) continue
        seen.add(real)
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
      const a = readAgent(join(wf.agentsDir, f), { usageOnly: true })
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
  'journal', 'status', 'claim', 'replan', 'preflight', 'parse-index', 'harness-context', 'ledger', 'crystallize', 'contract-check', 'release-claims', 'agent', 'stuck-judge'])
// Run-level kinds: whatever their label's rest holds (an agent name, a cycle), it is no task or repo.
const RUN_KINDS = new Set(['preflight', 'journal', 'status', 'claim', 'replan', 'hydrate', 'stuck-judge'])
const ATTEMPT_SUFFIX = /(?:#[^#:~+]*|~[^#:~+]*|\+[^#:~+]*)$/

/**
 * A dispatch label's kind, task, repo and lens, given the run's task ids and repo names. Labels are
 * `<kind>[:<rest>]` with suffixes the engine appends (`#<n>`, `~r<n>`, `+ctx<n>`, `:<stage>`); the
 * rest is shortened one suffix at a time, attempt suffixes before `:` segments, until it names a
 * task, a `<repo>:final` slot or a repo. Task ids may hold `#` and `:` themselves (`#5`,
 * `org/r:12`), so a suffix is dropped only when the whole rest fails. Run-level kinds (RUN_KINDS)
 * name no task or repo.
 */
export function attribute(label, { tasks = new Set(), repos = new Set() } = {}) {
  const none = { kind: 'unknown', task: null, repo: null, lens: null }
  if (typeof label !== 'string' || !label) return none
  const m = /^([^:#~+]+)(?::(.*))?/.exec(label)
  if (!m) return none
  const kind = m[1]
  const lens = ENGINE_KINDS.has(kind) ? null : kind
  if (RUN_KINDS.has(kind)) return { kind, task: null, repo: null, lens }
  let rest = m[2] ?? ''
  while (rest) {
    if (tasks.has(rest)) return { kind, task: rest, repo: (/^(.+):final$/.exec(rest) || [])[1] ?? null, lens }
    const fin = /^(.+):final$/.exec(rest)
    if (fin && repos.has(fin[1])) return { kind, task: rest, repo: fin[1], lens }
    if (repos.has(rest)) return { kind, task: null, repo: rest, lens }
    // an attempt suffix (#n, ~rn, +ctxn) goes before a `:<segment>`: a task id may hold ':' itself
    const shorter = ATTEMPT_SUFFIX.test(rest) ? rest.replace(ATTEMPT_SUFFIX, '') : rest.replace(/:[^:]*$/, '')
    if (shorter === rest) break
    rest = shorter
  }
  return { kind, task: null, repo: null, lens }
}

/** What a run's journal says about its labels: its task ids, its repos, and each task's repo. */
export function labelContext(events) {
  const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v))
  const tasks = new Set(), repos = new Set(), taskRepo = {}
  const start = (events || []).find((e) => e && e.type === 'run.start') || {}
  for (const r of Array.isArray(start.repos) ? start.repos : []) repos.add(str(isObj(r) && r.name != null ? r.name : r))
  for (const e of events || []) {
    if (!isObj(e)) continue
    if (e.task != null) tasks.add(str(e.task))
    if (e.repo != null) repos.add(str(e.repo))
    if (e.task != null && e.repo != null) taskRepo[str(e.task)] = str(e.repo)
  }
  return { tasks, repos, taskRepo }
}

/** attribute(), with the repo filled in from the task's when the label names a task only. */
export function attributeIn(label, ctx) {
  const a = attribute(label, ctx)
  return { ...a, repo: a.repo ?? (a.task != null ? ctx.taskRepo[a.task] ?? null : null) }
}

/** A root (as given and resolved through symlinks) and every git worktree of its repository: where a
 * run's sessions may have been launched. Claude Code names a project dir after the cwd it was given,
 * which may be either spelling (macOS's /var is /private/var). */
export function rootsOf(root) {
  const roots = new Set([root])
  try { roots.add(realpathSync(root)) } catch {}
  const r = spawnSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  if (r.status === 0) for (const l of r.stdout.split('\n')) if (l.startsWith('worktree ')) roots.add(l.slice('worktree '.length))
  return [...roots]
}

function costMain(argv) {
  const arg = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const runId = arg('run')
  if (argv[0] !== 'cost' || !runId) { console.error('usage: node scripts/economy/runs.mjs cost --run <runId> [--kind <kind>] [--root <dir>] [--claude-dir <dir>]'); return 2 }
  const root = resolve(arg('root') ?? process.cwd())
  const kind = arg('kind')
  const bill = runBill(runId, { claudeDir: arg('claude-dir') ?? undefined, roots: rootsOf(root) })
  const total = kind ? bill.dispatches.filter((d) => attribute(d.label).kind === kind).reduce((a, d) => a + d.effective, 0) : bill.total.effective
  console.log(bill.workflows.length ? `COST ${Math.round(total)}` : 'COST none')
  return 0
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) process.exitCode = costMain(process.argv.slice(2))
