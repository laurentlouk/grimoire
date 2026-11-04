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
// Learned environment facts (token economy slice 6, microsoft/TokenEconomizer's micro-skills): at
// SubagentStop (the agent's transcript) and SessionEnd (the session's), each dispatch or session is
// folded once (`facts/folded.json`), under a lock, into the store of each repo its calls ran in
// (`facts/<repo>.json`, scripts/economy/facts/). At SessionStart (startup, clear, compact; never
// resume), a session inside a repo gets that repo's block as additionalContext, and the ids it was
// shown are kept (`facts/sessions/<session_id>.json`) so its fold counts a prevented failure as fired.
// `economy.facts: "off"` learns and injects nothing. Transcripts are read at a stop, never on a call.
//
// This release changes nothing: it always answers `{}` to calls and stops, and `economy.loopGuard: "on"` records as
// "shadow" does until token economy slice 5 delivers redirects. No model call, no git, no transcript
// read on a call. Every failure answers `{}` and adds a line to `.grimoire/economy/errors.log`.
// `GRIMOIRE_ECONOMY=0` in the session's environment turns it off; so does `economy.loopGuard: "off"`
// in grimoire.config.json, read once per agent. One agent's parallel calls fold one at a time, under
// a per-agent lock. The wrapper (economy.sh) answers the main session's calls without starting node.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, appendFileSync, readdirSync, statSync, rmdirSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, economyDir } from '../../scripts/economy/paths.mjs'
import { loadConfig, mainCheckout } from '../../scripts/project-config.mjs'
import { newTurn, foldCall, resolved, freeVerdict, wantsJudge, decide, verificationState } from '../../scripts/economy/loopguard/turn.mjs'
import { recentDigest } from '../../scripts/economy/loopguard/state.mjs'
import { DEFAULT_THRESHOLDS } from '../../scripts/economy/loopguard/rules.mjs'
import { envelopeOf, withSample } from '../../scripts/economy/loopguard/envelope.mjs'
import { readTranscript } from '../../scripts/economy/transcript.mjs'
import { fromJSON, toJSON, update as foldFacts, render as renderFacts, injectedIds, seedInjected } from '../../scripts/economy/facts/families.mjs'

const AGENT_ID = /^[A-Za-z0-9_.-]{1,128}$/
const MODES = new Set(['off', 'shadow', 'on'])
const LOCK_WAIT_MS = 250
const CALL_LOCK_WAIT_MS = 2000 // a fold takes well under a millisecond: only a crashed holder waits this long
const LOCK_STALE_MS = 10000
const KEEP_TURNS_MS = 7 * 86400000
const KEEP_FOLDED = 5000 // the most recent folded dispatch and session keys
const KEEP_CONFIRMS = 50 // a fact's history, by fold: older confirmations weigh 0.8^age ≈ nothing
const KEEP_COUNTS = 20 // per count table of a fact (hosts, forms, values, examples): the most frequent
const INJECT_SOURCES = new Set(['startup', 'clear', 'compact'])
const CONTENT_TOOLS = new Set(['read', 'grep', 'glob', 'view'])
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
function writeJson(p, v) {
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(v))
  renameSync(tmp, p)
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * The text a call produced, for its failure markers: the failure's error, a string response, or a
 * command's stdout and stderr. Never a file's content: a Write's response carries the whole file it
 * wrote, and a Read's or a Grep's what it found, and a file full of `assert` is no failure.
 */
function resultText(toolName, response, error) {
  if (typeof error === 'string' && error) return error
  if (CONTENT_TOOLS.has(String(toolName).toLowerCase())) return ''
  if (typeof response === 'string') return response
  if (!isObj(response)) return ''
  return [response.stdout, response.stderr].filter((x) => typeof x === 'string' && x).join('\n')
}

// The repos[] entry a working directory is in, by its path under the main checkout; null outside every one.
// A git worktree of a repo (a loop lane, a session worktree) is that repo: its checkout's `.git` file
// names the repo's main checkout (no git subprocess).
function repoMatcher(root, config) {
  const base = mainCheckout(root) ?? root
  const repos = (Array.isArray(config?.repos) ? config.repos : []).filter((r) => isObj(r) && typeof r.name === 'string')
    .map((r) => ({ name: r.name, path: resolve(base, typeof r.path === 'string' && r.path ? r.path : r.name) }))
  const within = (where) => repos.find((r) => where === r.path || where.startsWith(r.path + sep))?.name ?? null
  const seen = new Map()
  return (cwd) => {
    if (typeof cwd !== 'string' || !cwd) return null
    const where = resolve(cwd)
    if (seen.has(where)) return seen.get(where)
    let name = within(where)
    for (let d = where; !name; d = resolve(d, '..')) {
      if (existsSync(join(d, '.git'))) { const main = mainCheckout(d); if (main) name = within(main); break }
      if (resolve(d, '..') === d) break
    }
    seen.set(where, name)
    return name
  }
}

// The agent's settings, read once at its first call: the mode, the thresholds and its repo.
function firstLook(root, cwd) {
  const { config } = loadConfig(root)
  const eco = isObj(config?.economy) ? config.economy : {}
  const mode = MODES.has(eco.loopGuard) ? eco.loopGuard : 'shadow'
  const thr = { ...DEFAULT_THRESHOLDS }
  for (const [k, v] of Object.entries(isObj(eco.loopGuardThresholds) ? eco.loopGuardThresholds : {})) if (k in thr && Number.isFinite(v) && v >= 0) thr[k] = v
  return { mode, thr, repo: repoMatcher(root, config)(cwd || root) }
}

// ── learned facts ──
const factsDir = (dir) => join(dir, 'facts')
const factsOn = (config) => !(isObj(config?.economy) && config.economy.facts === 'off')
const loadStore = (dir, repo) => fromJSON(readJson(join(factsDir(dir), `${repo}.json`)) ?? { repo }, repo)

// A fact's count tables kept to their most frequent entries, and its history to its last folds: the
// store is read at every SessionStart and rewritten at every fold.
function trimFact(f) {
  f.life.confirms = f.life.confirms.slice(-KEEP_CONFIRMS)
  f.life.contradicts = f.life.contradicts.slice(-KEEP_CONFIRMS)
  for (const [k, v] of Object.entries(f.params)) {
    if (!isObj(v) || !Object.values(v).every((n) => Number.isFinite(n))) continue
    const entries = Object.entries(v)
    if (entries.length > KEEP_COUNTS) f.params[k] = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, KEEP_COUNTS))
  }
}

// Fold one finished dispatch or session (`key`, once) into the store of each repo its calls ran in.
// Returns false when it was not folded (a busy lock), so a session keeps what it was shown.
function foldTranscript(dir, root, event, key, file, injected, now) {
  if (typeof file !== 'string' || !file) return true
  const { config } = loadConfig(root)
  if (!factsOn(config)) return true
  if (Object.hasOwn(readJson(join(factsDir(dir), 'folded.json')) ?? {}, key)) return true // folded already: no transcript read
  const repoOf = repoMatcher(root, config)
  const byRepo = new Map()
  for (const c of readTranscript(file).calls) {
    const repo = repoOf(c.cwd)
    if (repo) (byRepo.get(repo) ?? byRepo.set(repo, []).get(repo)).push(c)
  }
  mkdirSync(factsDir(dir), { recursive: true })
  const done = withLock(join(dir, 'facts.lock'), () => {
    const folded = readJson(join(factsDir(dir), 'folded.json')) ?? {}
    if (Object.hasOwn(folded, key)) return
    // every repo's new store is computed before anything is written: a repo whose fold throws is left
    // as it was (and logged), the others are written once, then the key, so a retry folds nothing twice
    const out = []
    for (const [repo, calls] of byRepo) {
      try {
        const store = loadStore(dir, repo)
        if (Array.isArray(injected?.[repo])) seedInjected(store, injected[repo])
        foldFacts(store, calls, { iid: key, at: new Date(now).toISOString() })
        for (const f of Object.values(store.facts)) trimFact(f)
        out.push([repo, toJSON(store)])
      } catch (e) {
        logError(dir, event, `facts of ${key.replace(':', ' ')} not folded into ${repo}: ${e && e.message ? e.message : e}`, now)
      }
    }
    for (const [repo, data] of out) writeJson(join(factsDir(dir), `${repo}.json`), data)
    folded[key] = now
    writeJson(join(factsDir(dir), 'folded.json'), Object.fromEntries(Object.entries(folded).sort((a, b) => a[1] - b[1]).slice(-KEEP_FOLDED)))
  })
  if (!done) logError(dir, event, `facts of ${key.replace(':', ' ')} not folded: the lock stayed busy`, now)
  return done
}

// SessionStart: the repo's block, and the ids it holds kept for the session's fold.
function onSessionStart(dir, root, payload) {
  if (!INJECT_SOURCES.has(payload.source)) return {}
  const { config } = loadConfig(root)
  if (!factsOn(config)) return {}
  const repo = repoMatcher(root, config)(payload.cwd)
  if (!repo || !existsSync(join(factsDir(dir), `${repo}.json`))) return {}
  const store = loadStore(dir, repo)
  const block = renderFacts(store)
  if (!block) return {}
  if (typeof payload.session_id === 'string' && AGENT_ID.test(payload.session_id)) {
    mkdirSync(join(factsDir(dir), 'sessions'), { recursive: true })
    writeJson(join(factsDir(dir), 'sessions', `${payload.session_id}.json`), { [repo]: injectedIds(store) })
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: block } }
}

function onSessionEnd(dir, root, payload, now) {
  if (typeof payload.session_id !== 'string' || !AGENT_ID.test(payload.session_id)) return
  const shown = join(factsDir(dir), 'sessions', `${payload.session_id}.json`)
  if (foldTranscript(dir, root, 'SessionEnd', `session:${payload.session_id}`, payload.transcript_path, readJson(shown), now)) rmSync(shown, { force: true })
}

function onCall(dir, payload, now) {
  mkdirSync(join(dir, 'turns'), { recursive: true })
  // one agent's parallel calls run concurrent hooks: fold them one at a time
  const folded = withLock(join(dir, 'turns', `${payload.agent_id}.lock`), () => foldOne(dir, payload, now), CALL_LOCK_WAIT_MS)
  if (!folded) logError(dir, payload.hook_event_name, `a call of ${payload.agent_id} was not folded: its state stayed locked`, now)
}

function foldOne(dir, payload, now) {
  const id = payload.agent_id
  const file = join(dir, 'turns', `${id}.json`)
  let t = readJson(file)
  if (isObj(t) && t.off) return
  if (!isObj(t) || t.v !== 1) {
    const root = projectRoot({ cwd: payload.cwd })
    const look = firstLook(root, payload.cwd)
    if (look.mode === 'off') return writeJson(file, { v: 1, off: true })
    t = { ...newTurn({ agentId: id, agentType: typeof payload.agent_type === 'string' ? payload.agent_type : null, cwd: payload.cwd ?? null, repo: look.repo, at: now }), mode: look.mode, thr: look.thr }
  }
  t.stopped = false // an agent resumed after it stopped is watched again
  const failed = payload.hook_event_name === 'PostToolUseFailure'
  const resp = payload.tool_response
  const exitCode = failed ? 1 : isObj(resp) && Number.isInteger(resp.exitCode) ? resp.exitCode : null
  foldCall(t, { name: payload.tool_name, args: isObj(payload.tool_input) ? payload.tool_input : {}, result: resultText(payload.tool_name, resp, payload.error), exitCode })
  const role = `${t.repo ?? '-'}/${t.agentType ?? '-'}`
  const envelope = envelopeOf(readJson(join(dir, 'envelope.json'))?.[role]?.resolved, t.thr)
  const shadow = true // "on" acts from token economy slice 5; until then it records as shadow does
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

function withLock(lock, fn, wait = LOCK_WAIT_MS) {
  const start = Date.now()
  for (;;) {
    try { mkdirSync(lock); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmdirSync(lock); continue } } catch {}
      if (Date.now() - start > wait) return false
      sleep(5)
    }
  }
  try { fn() } finally { try { rmdirSync(lock) } catch {} }
  return true
}

function onStop(dir, root, payload, now) {
  foldTranscript(dir, root, 'SubagentStop', `agent:${payload.agent_id}`, payload.agent_transcript_path, null, now)
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
  // states, judge requests and sessions' shown ids older than a week go (an agent that never stopped
  // leaves its request, a session that never ended its ids)
  for (const sub of ['turns', 'judge', join('facts', 'sessions')]) {
    let names = []
    try { names = readdirSync(join(dir, sub)) } catch {}
    for (const f of names) {
      const p = join(dir, sub, f)
      try { if (f.endsWith('.json') && now - statSync(p).mtimeMs > KEEP_TURNS_MS) rmSync(p, { force: true }) } catch {}
    }
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
  if (payload.hook_event_name === 'SessionStart' || payload.hook_event_name === 'SessionEnd') {
    const root = projectRoot({ env, cwd: payload.cwd })
    const dir = economyDir(root)
    if (payload.hook_event_name === 'SessionStart') return onSessionStart(dir, root, payload)
    onSessionEnd(dir, root, payload, now)
    return {}
  }
  const id = payload.agent_id
  if (typeof id !== 'string' || !AGENT_ID.test(id)) return {} // the main session: not watched in this release
  const root = projectRoot({ env, cwd: payload.cwd })
  const dir = economyDir(root)
  if (payload.hook_event_name === 'PostToolUse' || payload.hook_event_name === 'PostToolUseFailure') onCall(dir, payload, now)
  else if (payload.hook_event_name === 'SubagentStop') onStop(dir, root, payload, now)
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
