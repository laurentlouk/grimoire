#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  live — one compact JSON snapshot of what grimoire is doing right now
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/live.mjs [--root <project dir>] [--now <iso>] [--claude-dir <dir>]
//      → one line of JSON on stdout, exit 0, always: the run in progress (or the one that ended in
//        the last 6 h), the manager briefing's headline, and what the stuck watch flagged in the
//        last hour. For a live view drawn in Claude Code (a pane, a band, a status line) that runs
//        it every few seconds: it finds this script through <project>/.grimoire/live/plugin-root,
//        which the SessionStart hook hooks/scripts/live-pointer.sh writes.
//
//  Contract (version 1; a field is null when grimoire wrote nothing it can be read from):
//    { version: 1, at, root,
//      run: null | { id, status, haltReason, startedAt, updatedAt, isStale,
//                    tasks: { total, done, active, failed, blocked, queued },
//                    active: [{ task, title, step, agent, model, round, since }],   ≤ 8, newest first
//                    recent: [{ at, kind, task, text }],                            ≤ 8, newest first
//                    cost: { effective, maxCost, output, maxOutput, isCovered } },
//      briefing: null | { line, urgent, ready, isStale, isPartial, page },
//      watch: null | { mode, flags: [{ agent, reason, at }] },                       ≤ 5, last hour
//      errors: <how many parts failed and were left null> }
//
//  What it reads, through the parsers that own each file (nothing re-parsed here):
//    • the run journals, telemetry.dir (default .grimoire/runs, in the main checkout), with
//      render-logs.mjs loadRuns: only the run dirs written to in the last 13 h are read. The run
//      is the newest one still running (written to within render-logs' STALE_HOURS), else the
//      one whose last write is the most recent if that is under 6 h old, else null. `isStale`:
//      running with no journal write for 15 min. Status as render-logs names it (`running`,
//      `halted`, `drained`, `closed`, …).
//    • its cost: effective tokens from Claude Code's transcripts (economy/runs.mjs runBill and
//      render-logs costOf), cached in <main checkout>/.grimoire/live/cost.json under the runId,
//      the newest transcript's mtime and the journal's dispatch count. The snapshot reads the
//      cache only, never a transcript: a cache that is missing, another run's or 60 s old starts
//      `live.mjs --refresh-cost <runId>` in a detached child (one at a time, under cost.lock),
//      which a later snapshot reads; until the first one lands, `effective` is null. Output
//      tokens and the caps (maxCost, maxOutputTokens, from the newest session's run.start) come
//      from the journal itself. The cache and its lock are the only files it writes.
//    • the tasks: an ended run's counts are its own outcome (render-logs outcomeTasks: run.end,
//      else run.json's summary); a running run's are counted from the checkpoint and the journal
//      (taskStates). A task an earlier session left in flight, and the current one has not
//      dispatched again, is queued, never active: that session is gone.
//    • the briefing: manager.mjs briefingAt, the line `manager.mjs headline` prints.
//    • the stuck watch: the mode from the config (hooks/scripts/economy.mjs guardMode), and the
//      verdicts it recorded in .grimoire/economy/turns/<agent>.json in the last hour.
//
//  What never reaches the output: ticket text (a task's title is the tracker issue's, and the
//  journal holds none for a task in flight: `title` is always null),
//  halt and replan reasons, review findings, summaries, judge text, claim identities, URLs. Every
//  string is an id, an enum, a number or a time, checked against a pattern before it is printed;
//  anything else prints as `?` (the headline line is manager.mjs's, under its own rules).
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, lstatSync, realpathSync, existsSync, rmdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig, loadConfig, mainCheckout } from './project-config.mjs'
import { loadRuns, costOf, finalTokens, outcomeTasks, STALE_HOURS, LANDED } from './render-logs.mjs'
import { briefingAt, briefingStale, briefingPartial, runsDirOf } from './manager.mjs'
import { indexWorkflows, runBill, rootsOf } from './economy/runs.mjs'
import { economyDir } from './economy/paths.mjs'
import { guardMode } from '../hooks/scripts/economy.mjs'

export const LIVE_VERSION = 1
const MIN = 60000
const HOUR = 3600000
export const ACTIVE_MAX = 8
export const RECENT_MAX = 8
export const FLAGS_MAX = 5
export const STALE_MIN = 15 // a running run with no journal write for this long reads as stale
export const ENDED_WITHIN_H = 6 // an ended run is shown while its last write is younger than this
export const COST_EVERY_MS = 60000 // the transcripts are looked at again at most this often
export const WATCH_WINDOW_MS = HOUR
const TEXT_MAX = 100
const READ_WITHIN_H = Math.max(STALE_HOURS, ENDED_WITHIN_H) + 1 // run dirs older than this are not read
const LANDED_SET = new Set(LANDED)
const SLOT = /:(final|gate)$/ // a repo's terminal and gate slots: no plan task
const FLAG_ACTIONS = new Set(['redirect', 'block', 'would-redirect', 'would-block'])
const HALT_KINDS = new Set(['environment', 'wedged', 'harness'])

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const mtime = (p) => { try { return lstatSync(p).mtimeMs } catch { return 0 } }
// An id, an enum, a name: one token of safe characters, else null. Free text (a title, a reason)
// has spaces or punctuation and never passes.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@+~-]{0,79}$/
const id = (v) => (typeof v === 'string' && ID.test(v) ? v : num(v) !== null ? String(v) : null)
const word = (v) => id(v) ?? '?'
const count = (v) => (num(v) !== null ? String(Math.round(v)) : '?')
// the stuck watch's own reason codes: `backstop:40>=38`, `judge-stuck@0.85`
const REASON = /^[A-Za-z0-9][A-Za-z0-9._:@<>=+-]{0,59}$/
// A time as ISO, or null: not a time, or outside what a Date holds (±8.64e15 ms), which
// toISOString would throw on.
const iso = (v) => {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) && Math.abs(t) <= 8.64e15 ? new Date(t).toISOString() : null
}
// An own entry of a lookup table: an event type such as `constructor` or `__proto__` is no key.
const own = (table, k) => (typeof k === 'string' && Object.hasOwn(table, k) ? table[k] : undefined)
const attemptOf = (e) => num(e.attempt) ?? 1
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// ── the run ──

// The run dirs worth reading: written to (the dir, run.json, a chunk) in the last READ_WITHIN_H.
const recentDir = (now) => (name, p) => Math.max(mtime(p), mtime(join(p, 'run.json')), mtime(join(p, 'events')), mtime(join(p, 'events.jsonl'))) >= now - READ_WITHIN_H * HOUR

/** The run the snapshot shows, or null: of the runs still running (written to within STALE_HOURS),
 * the one written to last (a resumed run keeps its first startedAt, so start order says nothing);
 * else the run written to last, if that is under ENDED_WITHIN_H ago. */
export function pickRun(runs, now) {
  const at = (r) => Date.parse(r.updatedAt ?? '')
  const byWrite = runs.filter((r) => Number.isFinite(at(r))).sort((a, b) => at(b) - at(a))
  return byWrite.find((r) => r.status === 'running' && now - at(r) <= STALE_HOURS * HOUR)
    ?? byWrite.find((r) => now - at(r) < ENDED_WITHIN_H * HOUR) ?? null
}

// Each plan task's state, from the checkpoint and the journal in order. A task is the run's when the
// checkpoint holds it as pending or as landed by the run (`landedTasks`: never `landed`, which also
// holds the issues already done in the tracker before the run), or the journal routed, dispatched,
// settled or absorbed it. queued until dispatched; active from a dispatch of the CURRENT session
// until it settles; then done, or failed (any other status, BLOCKED included, as the engine's
// run.end counts it). A task an earlier session dispatched and never settled, and the current one
// has not dispatched again, is queued: that session died, and a resume runs the task again (it is
// still in the checkpoint's pending). A later dispatch, after a replan, makes a task active again.
// The step is the stage of the task's latest decision.
const STEP = { dispatch: 'build', precheck: 'precheck', review: 'review', verify: 'review', guard: 'review', fast: 'review', fix: 'fix', escalate: 'fix', resolve: 'resolve', integrate: 'integrate' }
export function taskStates(run) {
  const tasks = new Map()
  const get = (key) => {
    if (!tasks.has(key)) tasks.set(key, { id: key, state: 'queued', step: null, agent: null, model: null, round: null, since: null, seq: -1 })
    return tasks.get(key)
  }
  const cp = isObj(run.checkpoint) ? run.checkpoint : {}
  // the session writing now: the newest the journal or the checkpoint names
  const current = Math.max(num(cp.attempt) ?? 1, ...run.events.map(attemptOf))
  for (const t of Array.isArray(cp.pending) ? cp.pending : []) if (id(t) && !SLOT.test(t)) get(String(t))
  for (const t of Array.isArray(cp.landedTasks) ? cp.landedTasks : []) if (isObj(t) && id(t.id) && !SLOT.test(t.id)) get(String(t.id)).state = 'done'
  run.events.forEach((e, i) => {
    if (e.task == null || e.type === 'claim') return // a claim skipped is another session's task
    const key = id(e.task)
    if (!key || SLOT.test(key)) return
    const t = get(key)
    if (e.type === 'route') { t.agent = id(e.agent) ?? t.agent; t.model = id(e.model) ?? t.model }
    else if (e.type === 'dispatch') Object.assign(t, { state: attemptOf(e) === current ? 'active' : 'queued', step: 'build', agent: id(e.agent) ?? t.agent, model: id(e.model) ?? t.model, round: 0, since: iso(e.at), seq: i })
    else if (e.type === 'settle') t.state = LANDED_SET.has(e.status) ? 'done' : 'failed'
    else if (e.type === 'absorb') t.state = 'done'
    const step = own(STEP, e.type)
    if (step && e.type !== 'dispatch') t.step = step
    if (e.type === 'fix') { t.model = id(e.model) ?? t.model; t.round = num(e.round) ?? t.round }
    if (e.type === 'review' && num(e.round) !== null) t.round = Math.max(t.round ?? 0, e.round)
    if (e.type === 'escalate') t.model = id(e.to) ?? t.model
  })
  return [...tasks.values()]
}

// The counts and the active tasks. An ended run's counts are its own outcome (render-logs
// outcomeTasks: the newest session's run.end, else run.json's summary), what never ran counted
// blocked there; the active list is then the tasks its last session left in flight, as many as it
// counted. A running run, or an ended one whose end was lost, is counted from taskStates, and on an
// ended one what never ran is blocked, not queued.
export function taskView(run) {
  const states = taskStates(run)
  const active = states.filter((t) => t.state === 'active').sort((a, b) => b.seq - a.seq)
  const n = (s) => states.filter((t) => t.state === s).length
  if (run.status !== 'running') {
    const o = outcomeTasks(run)
    if (o.source !== 'settles') {
      const t = o.tasks
      return { tasks: { total: t.landed + t.failed + t.blocked + t.inFlight, done: t.landed, active: t.inFlight, failed: t.failed, blocked: t.blocked, queued: 0 }, active: active.slice(0, t.inFlight) }
    }
    return { tasks: { total: states.length, done: n('done'), active: n('active'), failed: n('failed'), blocked: n('blocked') + n('queued'), queued: 0 }, active }
  }
  return { tasks: { total: states.length, done: n('done'), active: n('active'), failed: n('failed'), blocked: n('blocked'), queued: n('queued') }, active }
}

// The halt's code: budget_exhausted (a cap) or budget_floor, else the halt's kind, else
// `unclassified` (render-logs' word for a halt with no kind). Never the reason's text.
const haltCodeOf = (h) => (!isObj(h) ? 'unclassified'
  : h.kind === 'budget' ? (typeof h.reason === 'string' && h.reason.startsWith('budget_exhausted') ? 'budget_exhausted' : 'budget_floor')
    : HALT_KINDS.has(h.kind) ? h.kind : 'unclassified')
export function haltCode(run) {
  if (run.status !== 'halted') return null
  return haltCodeOf([...run.events].reverse().find((e) => e.type === 'halt') || run.summary?.halt)
}

// One line per decision, built from its ids, verdicts, agents, models and counts only.
const T = (e) => word(e.task)
const TEXT = {
  'run.start': (e) => `run started${e.resumed ? ' (resumed)' : ''} · ${Array.isArray(e.repos) ? e.repos.length : '?'} repo(s)`,
  'run.end': (e) => `run ${word(e.status)} · ${count(e.done)} done, ${count(e.failed)} failed, ${count(e.blocked)} blocked, ${count(e.prs)} PR(s)`,
  'run.close': (e) => `run closed · ${word(e.reason)}`,
  route: (e) => `${T(e)} routed to ${word(e.agent)} on ${word(e.model)}${id(e.policy) ? ` · ${e.policy}` : ''}${e.fallback ? ' · fallback' : ''}`,
  dispatch: (e) => `${T(e)} dispatched to ${word(e.agent)} on ${word(e.model)}`,
  precheck: (e) => `${T(e)} precheck ${word(e.verdict)}${Array.isArray(e.problems) && e.problems.length ? ` · ${e.problems.length} problem(s)` : ''}`,
  review: (e) => `${T(e)} ${word(e.stage)} review ${word(e.persona)}: ${word(e.verdict)} · ${count(e.gating)} gating${num(e.round) !== null ? ` · round ${e.round}` : ''}${e.discarded ? ' · discarded' : ''}`,
  verify: (e) => `${T(e)} verify · ${count(e.confirmed)} kept, ${count(e.overturned)} overturned`,
  guard: (e) => `${T(e)} guard ${word(e.decision)}${num(e.round) !== null ? ` · round ${e.round}` : ''}`,
  fix: (e) => `${T(e)} fix round ${count(e.round)} on ${word(e.model)} · ${count(e.findings)} finding(s)`,
  escalate: (e) => `${T(e)} escalated ${word(e.from)} → ${word(e.to)}`,
  resolve: (e) => `${T(e)} context from ${word(e.scout)}: ${e.answered ? 'answered' : 'unanswered'}`,
  integrate: (e) => `${T(e)} integrate ${word(e.status)}`,
  settle: (e) => `${T(e)} settled ${word(e.status)}`,
  fast: (e) => `${T(e)} fast review ${word(e.verdict)} → ${word(e.then)}`,
  absorb: (e) => `${T(e)} absorbed · ${word(e.source)}`,
  claim: (e) => `${T(e)} claim ${word(e.action)}`,
  replan: (e) => `replan #${count(e.n)}: ${word(e.decision)}${id(e.cause) ? ` · cause ${e.cause}` : ''} · ${count(e.requeued)} requeued`,
  halt: (e) => `halt · ${haltCodeOf(e)}`,
  budget: (e) => `budget ${e.kind === 'cost' ? 'cost' : e.kind === 'judge' ? 'judge' : 'output'} ${word(e.action)} · ${count(e.spent)} of ${count(e.cap)}`,
  stuck: (e) => `stuck watch ${word(e.action)} · ${word(e.agentType ?? e.agent)}${num(e.confidence) !== null ? ` @${e.confidence.toFixed(2)}` : ''}`,
  terminal: (e) => `${word(e.repo)} terminal sweep ${word(e.verdict)}`,
  gate: (e) => `${word(e.repo)} gate ${word(e.status)}${e.applies === false ? ' · not applicable' : ''}`,
  ship: (e) => `${word(e.repo)} ship${id(e.skipped) ? ` skipped (${e.skipped})` : id(e.failedStep) ? ` failed at ${e.failedStep}` : e.pushed ? ' pushed' : ''}`,
  late: (e) => `${e.task != null ? T(e) : word(e.label)} late · past ${count(e.softMin)} min`,
  wedged: (e) => `${e.task != null ? T(e) : word(e.label)} wedged · past ${count(e.hardMin)} min`,
}
const SKIP = new Set(['landed.flush']) // the writer's own bookkeeping, no decision
export function decisionText(e) {
  const f = own(TEXT, e.type)
  return cut(f ? f(e) : `${word(e.type)}${e.task != null ? ` · ${T(e)}` : ''}`, TEXT_MAX)
}

// ── cost: effective tokens from the transcripts, cached ──

const newestTranscript = (wfs) => {
  let newest = 0
  for (const wf of wfs) {
    newest = Math.max(newest, mtime(wf.file))
    let names = []
    try { names = readdirSync(wf.agentsDir) } catch {}
    for (const n of names) if (/^agent-.*\.jsonl$/.test(n)) newest = Math.max(newest, mtime(join(wf.agentsDir, n)))
  }
  return newest
}

const liveDir = (stateRoot) => join(stateRoot, '.grimoire', 'live')
const COST_LOCK_STALE_MS = 2 * MIN // a refresh that died left its lock: broken after this

/** Recompute the cache (the detached child's work): the bill again when a transcript or a dispatch
 * moved since the cached key, else the cached bill stamped as checked. {effective, dispatched,
 * matched, ...}. Writes nothing when the project's .grimoire/ is gone. */
export function refreshCost(run, { stateRoot, root, claudeDir, now = Date.now() }) {
  const file = join(liveDir(stateRoot), 'cost.json')
  const cache = readJson(file)
  const same = isObj(cache) && cache.v === 1 && cache.runId === run.runId
  const roots = [...new Set([...rootsOf(stateRoot), root])]
  const index = indexWorkflows({ claudeDir, roots })
  const wfs = index.get(run.runId) || []
  const key = `${run.runId}|${newestTranscript(wfs)}|${run.events.filter((e) => e.type === 'dispatch').length}`
  let out
  if (same && cache.key === key) out = { ...cache, checkedAt: now }
  else {
    const { cost, costCoverage } = costOf(run, runBill(run.runId, { claudeDir, index }))
    out = { v: 1, runId: run.runId, key, checkedAt: now, effective: cost ? cost.effective : null, dispatched: costCoverage.dispatched, matched: costCoverage.matched }
  }
  if (!existsSync(join(stateRoot, '.grimoire'))) return out
  mkdirSync(liveDir(stateRoot), { recursive: true })
  const tmp = `${file}.${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(out)}\n`)
  renameSync(tmp, file)
  return out
}

// Starts the refresh in a detached child and does not wait for it (the snapshot stays off the
// transcripts): unless one is already at work (its lock, cost.lock, younger than COST_LOCK_STALE_MS).
function refreshInChild(run, { stateRoot, root, claudeDir }) {
  if (!existsSync(join(stateRoot, '.grimoire'))) return
  try { if (Date.now() - statSync(join(liveDir(stateRoot), 'cost.lock')).mtimeMs < COST_LOCK_STALE_MS) return } catch {}
  const args = [fileURLToPath(import.meta.url), '--refresh-cost', String(run.runId), '--root', root, ...(claudeDir ? ['--claude-dir', claudeDir] : [])]
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref()
}

/** The run's bill from the cache, never from a transcript: the cache when it is the run's, else
 * null. A cache that is missing, another run's or COST_EVERY_MS old starts a refresh in a detached
 * child, read by a later snapshot. */
export function runCost(run, ctx, { refresh = refreshInChild } = {}) {
  const now = ctx.now ?? Date.now()
  const cache = readJson(join(liveDir(ctx.stateRoot), 'cost.json'))
  const same = isObj(cache) && cache.v === 1 && cache.runId === run.runId
  const fresh = same && num(cache.checkedAt) !== null && now >= cache.checkedAt && now - cache.checkedAt < COST_EVERY_MS
  if (!fresh) refresh(run, ctx)
  return same ? cache : null
}

// `--refresh-cost <runId>`: the child. One at a time per project, under cost.lock (a directory).
function refreshMain(runId, root, claudeDir) {
  const stateRoot = mainCheckout(root) ?? root
  if (!existsSync(join(stateRoot, '.grimoire'))) return
  mkdirSync(liveDir(stateRoot), { recursive: true })
  const lock = join(liveDir(stateRoot), 'cost.lock')
  try { mkdirSync(lock) } catch {
    try { if (Date.now() - statSync(lock).mtimeMs < COST_LOCK_STALE_MS) return; rmdirSync(lock); mkdirSync(lock) } catch { return }
  }
  try {
    const now = Date.now()
    const run = loadRuns(runsDirOf(readConfig(root), root), { only: recentDir(now) }).find((r) => r.runId === runId)
    if (run) refreshCost(run, { stateRoot, root, claudeDir, now })
  } finally { try { rmdirSync(lock) } catch {} }
}

function costPart(run, ctx, fail) {
  // the caps of the session writing now: a resume can raise them (the events are in session order)
  const start = [...run.events].reverse().find((e) => e.type === 'run.start')
  const knobs = isObj(start?.knobs) ? start.knobs : {}
  const cap = (v) => (num(v) !== null && v > 0 ? v : null)
  const cpSpent = num(run.checkpoint?.outputTokensSpent)
  // a running session's checkpoint counts its resumed sessions too; an ended run's run.end is final
  const output = run.status === 'running' ? cpSpent ?? finalTokens(run) : finalTokens(run) ?? cpSpent
  let c = null
  try { c = runCost(run, ctx) } catch { fail() }
  const effective = c && num(c.effective) !== null ? c.effective : null
  return {
    effective,
    maxCost: cap(knobs.maxCost),
    output,
    maxOutput: cap(knobs.maxOutputTokens),
    // every dispatched task's implementer transcript was found: the bill is the whole run's
    isCovered: effective !== null && num(c.dispatched) !== null && c.matched === c.dispatched,
  }
}

function runPart(root, stateRoot, now, claudeDir, fail) {
  const dir = runsDirOf(readConfig(root), root)
  const run = pickRun(loadRuns(dir, { only: recentDir(now) }), now)
  if (!run) return null
  const view = taskView(run)
  const updated = Date.parse(run.updatedAt ?? '')
  const active = view.active.slice(0, ACTIVE_MAX).map((t) => ({ task: t.id, title: null, step: t.step, agent: t.agent, model: t.model, round: t.round, since: t.since }))
  const recent = run.events.filter((e) => typeof e.type === 'string' && !SKIP.has(e.type)).slice(-RECENT_MAX).reverse()
    .map((e) => ({ at: iso(e.at), kind: word(e.type), task: e.task != null ? id(e.task) : null, text: decisionText(e) }))
  return {
    id: id(run.runId) ?? word(run.dirName),
    status: word(run.status),
    haltReason: haltCode(run),
    startedAt: iso(run.startedAt),
    updatedAt: iso(run.updatedAt),
    isStale: run.status === 'running' && Number.isFinite(updated) && now - updated > STALE_MIN * MIN,
    tasks: view.tasks,
    active,
    recent,
    cost: costPart(run, { stateRoot, root, claudeDir, now }, fail),
  }
}

// ── the briefing ──

function briefingPart(root, now) {
  const b = briefingAt(root, { now })
  if (!b) return null
  const c = b.front.counts
  return {
    line: b.line,
    urgent: num(c.urgent),
    ready: num(c.ai),
    isStale: briefingStale(b.at, { now, schedule: b.schedule }),
    isPartial: briefingPartial(b.front),
    page: b.page && b.line.includes(` · page ${b.page}`) ? b.page : null, // only what the line itself shows
  }
}

// ── the stuck watch ──

function watchPart(root, now) {
  const mode = guardMode(loadConfig(root).config)
  const dir = join(economyDir(root), 'turns')
  let names = []
  try { names = readdirSync(dir) } catch {}
  const flags = []
  for (const f of names) {
    if (!f.endsWith('.json')) continue
    const p = join(dir, f)
    try { if (!statSync(p).isFile() || statSync(p).mtimeMs < now - WATCH_WINDOW_MS) continue } catch { continue }
    const t = readJson(p)
    if (!isObj(t) || !Array.isArray(t.events)) continue
    for (const e of t.events) {
      if (!isObj(e) || !FLAG_ACTIONS.has(e.action) || num(e.at) === null || e.at < now - WATCH_WINDOW_MS) continue
      const why = typeof e.reason === 'string' && REASON.test(e.reason) ? ` ${e.reason}` : ''
      flags.push({ agent: id(t.agentType) ?? id(t.agentId) ?? '?', reason: `${e.action}${why}`, at: iso(e.at), ms: e.at })
    }
  }
  flags.sort((a, b) => b.ms - a.ms)
  return { mode, flags: flags.slice(0, FLAGS_MAX).map(({ ms, ...f }) => f) }
}

// ── the snapshot ──

/** The snapshot for the project at root. Never throws: a part that fails is null and counted. */
export function snapshot({ root = process.cwd(), now = Date.now(), claudeDir } = {}) {
  let errors = 0
  const fail = () => { errors++ }
  const part = (fn) => { try { return fn() } catch { fail(); return null } }
  const abs = resolve(root)
  const stateRoot = part(() => mainCheckout(abs) ?? abs) ?? abs
  const run = part(() => runPart(abs, stateRoot, now, claudeDir, fail))
  const briefing = part(() => briefingPart(abs, now))
  const watch = part(() => watchPart(abs, now))
  return { version: LIVE_VERSION, at: new Date(now).toISOString(), root: abs, run, briefing, watch, errors }
}

function arg(argv, k) {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

function main(argv) {
  const root = resolve(arg(argv, 'root') ?? process.cwd())
  if (argv.includes('--refresh-cost')) {
    try { refreshMain(arg(argv, 'refresh-cost'), root, arg(argv, 'claude-dir') ?? undefined) } catch {}
    return 0
  }
  let out
  try {
    const at = arg(argv, 'now')
    const now = at === null ? Date.now() : Date.parse(at)
    if (!Number.isFinite(now)) throw new Error('--now: not a time')
    out = snapshot({ root, now, claudeDir: arg(argv, 'claude-dir') ?? undefined })
  } catch {
    out = { version: LIVE_VERSION, at: new Date().toISOString(), root, run: null, briefing: null, watch: null, errors: 1 }
  }
  process.stdout.write(`${JSON.stringify(out)}\n`)
  return 0
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) process.exitCode = main(process.argv.slice(2))
