#!/usr/bin/env node
// grimoire · economy hook: the stuck watch on dispatched agents (token economy slice 3, shadow).
//
// Runs on PostToolUse and PostToolUseFailure, and on SubagentStop. Inside a subagent (the hook
// input carries `agent_id`) each completed call is folded into that agent's state,
// `.grimoire/economy/turns/<agent_id>.json` (scripts/economy/loopguard/turn.mjs), in the project's
// main checkout. Then:
//   • the free rules: stuck past the role's envelope (or 2.5× it, the backstop) is recorded as
//     would-redirect, a later one as would-block, in the state's `events`;
//   • the gate (≥ 18 calls, and a repeated failure or ≥ 8 error outputs) writes a judge request,
//     `judge/<agent_id>.request.json`: the digest of counts and recent actions, never file content;
//   • a verdict a judge left in `judge/<agent_id>.result.json` is recorded the same way.
// At SubagentStop a dispatch that ended green (no failed check after its last edit) feeds its role's
// envelope, `envelope.json` (per repo and agent type), under a lock; a busy lock drops the sample.
//
// Shadow mode changes nothing: it always answers `{}`. No model call, no git, no transcript read on
// a call. Every failure answers `{}` and adds a line to `.grimoire/economy/errors.log`.
// `GRIMOIRE_ECONOMY=0` turns it off (a judge dispatch sets it, so the watch never watches itself);
// so does `economy.loopGuard: "off"` in grimoire.config.json, read once per agent.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, appendFileSync, readdirSync, statSync, rmdirSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, economyDir } from '../../scripts/economy/paths.mjs'
import { loadConfig, mainCheckout } from '../../scripts/project-config.mjs'
import { newTurn, foldCall, resolved, freeVerdict, wantsJudge, decide, verificationState } from '../../scripts/economy/loopguard/turn.mjs'
import { recentDigest } from '../../scripts/economy/loopguard/state.mjs'
import { DEFAULT_THRESHOLDS } from '../../scripts/economy/loopguard/rules.mjs'
import { envelopeOf, withSample } from '../../scripts/economy/loopguard/envelope.mjs'

const AGENT_ID = /^[A-Za-z0-9_.-]{1,128}$/
const MODES = new Set(['off', 'shadow', 'on'])
const LOCK_WAIT_MS = 250
const LOCK_STALE_MS = 10000
const KEEP_TURNS_MS = 7 * 86400000
const CONTENT_TOOLS = new Set(['read', 'grep', 'glob', 'view'])
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
function writeJson(p, v) {
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(v))
  renameSync(tmp, p)
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** The text a tool returned, for its failure markers; a content tool's is never read (it cannot fail by its content). */
function resultText(toolName, response, error) {
  if (typeof error === 'string' && error) return error
  if (CONTENT_TOOLS.has(String(toolName).toLowerCase())) return ''
  if (typeof response === 'string') return response
  if (!isObj(response)) return ''
  const parts = [response.stdout, response.stderr, response.output, response.error].filter((x) => typeof x === 'string' && x)
  if (parts.length) return parts.join('\n')
  return typeof response.content === 'string' ? response.content : ''
}

// The agent's settings, read once at its first call: the mode, the thresholds and its repo.
function firstLook(root, cwd) {
  const { config } = loadConfig(root)
  const eco = isObj(config?.economy) ? config.economy : {}
  const mode = MODES.has(eco.loopGuard) ? eco.loopGuard : 'shadow'
  const thr = { ...DEFAULT_THRESHOLDS }
  for (const [k, v] of Object.entries(isObj(eco.loopGuardThresholds) ? eco.loopGuardThresholds : {})) if (k in thr && Number.isFinite(v) && v >= 0) thr[k] = v
  const base = mainCheckout(root) ?? root
  const where = resolve(cwd || root)
  let repo = null
  for (const r of Array.isArray(config?.repos) ? config.repos : []) {
    if (!isObj(r) || typeof r.name !== 'string') continue
    const p = resolve(base, typeof r.path === 'string' && r.path ? r.path : r.name)
    if (where === p || where.startsWith(p + sep)) { repo = r.name; break }
  }
  return { mode, thr, repo }
}

function onCall(dir, payload, now) {
  const id = payload.agent_id
  const file = join(dir, 'turns', `${id}.json`)
  let t = readJson(file)
  if (isObj(t) && t.off) return
  if (!isObj(t) || t.v !== 1) {
    const root = projectRoot({ cwd: payload.cwd })
    const look = firstLook(root, payload.cwd)
    mkdirSync(join(dir, 'turns'), { recursive: true })
    if (look.mode === 'off') return writeJson(file, { v: 1, off: true })
    t = { ...newTurn({ agentId: id, agentType: typeof payload.agent_type === 'string' ? payload.agent_type : null, cwd: payload.cwd ?? null, repo: look.repo, at: now }), mode: look.mode, thr: look.thr }
  }
  const failed = payload.hook_event_name === 'PostToolUseFailure'
  const resp = payload.tool_response
  const exitCode = failed ? 1 : isObj(resp) && Number.isInteger(resp.exitCode) ? resp.exitCode : null
  foldCall(t, { name: payload.tool_name, args: isObj(payload.tool_input) ? payload.tool_input : {}, result: resultText(payload.tool_name, resp, payload.error), exitCode })
  const role = `${t.repo ?? '-'}/${t.agentType ?? '-'}`
  const envelope = envelopeOf(readJson(join(dir, 'envelope.json'))?.[role]?.resolved, t.thr)
  const shadow = t.mode !== 'on'
  // a judge's verdict on this segment, left by the engine's stuck-judge dispatch
  const resultFile = join(dir, 'judge', `${id}.result.json`)
  if (existsSync(resultFile)) {
    const v = readJson(resultFile)
    rmSync(resultFile, { force: true })
    if (isObj(v) && v.segment === t.segment && !t.blocked) {
      const conf = Number(v.confidence) || 0
      if (v.stuck === true && conf >= t.thr.judge_confidence) decide(t, `judge-stuck@${conf.toFixed(2)}`, { shadow, at: now })
      else t.events.push({ action: 'spared', reason: v.stuck === false ? 'judge-productive' : 'judge-unsure', calls: t.calls, segment: t.segment, at: now })
    }
  }
  if (!t.blocked) {
    const free = freeVerdict(t, envelope, t.thr)
    if (free) decide(t, `${free}:${t.calls}>=${Math.round(free === 'backstop' ? envelope * t.thr.backstop_mult : envelope)}`, { shadow, at: now })
  }
  if (wantsJudge(t, t.thr)) {
    mkdirSync(join(dir, 'judge'), { recursive: true })
    writeJson(join(dir, 'judge', `${id}.request.json`), { v: 1, agentId: id, agentType: t.agentType, repo: t.repo, segment: t.segment, calls: t.calls, at: now,
      digest: recentDigest(t.st, { envelope, verification: verificationState(t) }) })
    t.lastRequestAt = t.st.turns
  }
  t.updatedAt = now
  writeJson(file, t)
}

function withLock(lock, fn) {
  const start = Date.now()
  for (;;) {
    try { mkdirSync(lock); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmdirSync(lock); continue } } catch {}
      if (Date.now() - start > LOCK_WAIT_MS) return false
      sleep(10)
    }
  }
  try { fn() } finally { try { rmdirSync(lock) } catch {} }
  return true
}

function onStop(dir, payload, now) {
  const file = join(dir, 'turns', `${payload.agent_id}.json`)
  const t = readJson(file)
  if (!isObj(t) || t.v !== 1 || t.off || t.stopped) return
  t.stopped = true
  t.updatedAt = now
  writeJson(file, t)
  rmSync(join(dir, 'judge', `${payload.agent_id}.request.json`), { force: true })
  if (resolved(t)) {
    const role = `${t.repo ?? '-'}/${t.agentType ?? '-'}`
    const fed = withLock(join(dir, 'envelope.lock'), () => writeJson(join(dir, 'envelope.json'), withSample(readJson(join(dir, 'envelope.json')), role, t.calls)))
    if (!fed) logError(dir, 'SubagentStop', `envelope sample of ${role} (${t.calls} calls) dropped: the lock stayed busy`, now)
  }
  // stopped agents' states older than a week go
  for (const f of readdirSync(join(dir, 'turns'))) {
    const p = join(dir, 'turns', f)
    try { if (now - statSync(p).mtimeMs > KEEP_TURNS_MS) rmSync(p, { force: true }) } catch {}
  }
}

function logError(dir, event, message, now) {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'errors.log'), `${new Date(now).toISOString()} ${event || '?'} ${String(message).replace(/\s+/g, ' ').slice(0, 300)}\n`)
  } catch {}
}

/** One hook call; always `{}` in this release. Throws only on input that is not a hook payload. */
export function handle(payload, { env = process.env, now = Date.now() } = {}) {
  if (env.GRIMOIRE_ECONOMY === '0') return {}
  if (!isObj(payload)) throw new Error('the hook input is not a JSON object')
  const id = payload.agent_id
  if (typeof id !== 'string' || !AGENT_ID.test(id)) return {} // the main session: not watched in this release
  const dir = economyDir(projectRoot({ env, cwd: payload.cwd }))
  if (payload.hook_event_name === 'PostToolUse' || payload.hook_event_name === 'PostToolUseFailure') onCall(dir, payload, now)
  else if (payload.hook_event_name === 'SubagentStop') onStop(dir, payload, now)
  return {}
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) {
  let input = ''
  try { input = readFileSync(0, 'utf8') } catch {}
  let payload = null
  try {
    try { payload = JSON.parse(input) } catch (e) {
      // Node's parse error can quote the input (a command, a token): only its position is logged
      const at = /line \d+ column \d+|position \d+/.exec(String(e.message))
      throw new Error(`the hook input is not JSON${at ? ` (at ${at[0]})` : ''}`)
    }
    process.stdout.write(JSON.stringify(handle(payload)))
  } catch (e) {
    const now = Date.now()
    let dir = null
    try { dir = economyDir(projectRoot({ cwd: isObj(payload) ? payload.cwd : null })) } catch {}
    if (dir && process.env.GRIMOIRE_ECONOMY !== '0') logError(dir, isObj(payload) ? payload.hook_event_name : 'unparsed', e && e.message ? e.message : e, now)
    process.stdout.write('{}')
  }
}
