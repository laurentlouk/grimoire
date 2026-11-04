#!/usr/bin/env node
// grimoire · economy hook: the stuck watch (token economy slices 3 and 5).
//
// Runs on PostToolUse and PostToolUseFailure, and on SubagentStop. Inside a subagent (the hook
// input carries `agent_id`) each completed call is folded into that agent's state,
// `.grimoire/economy/turns/<agent_id>.json` (scripts/economy/loopguard/turn.mjs), in the project's
// main checkout. Then:
//   • the free rule: stuck past 2.5× the role's envelope (the backstop) is a stuck verdict;
//   • the gate (≥ 18 calls, and a repeated failure or ≥ 8 error outputs) writes a judge request,
//     `judge/<agent_id>.request.json`: the digest of counts and recent actions, never file content;
//   • a verdict a judge left in `judge/<agent_id>.result.json` is a stuck verdict too.
// The first stuck verdict redirects and starts a fresh segment, a later one blocks. Under
// `economy.loopGuard: "on"` the agent is told, as additionalContext under the event name the call came
// in on (spike S1: it reaches the subagent's own context): the judge's redirect, else the template;
// then one line telling it to return BLOCKED (`STUCK WATCH:` heads its summary, for the engine's
// resolve rung). Under "shadow" (the default) both are only recorded, as would-redirect and would-block.
//
// The main session (no `agent_id`) is watched only under "on", per prompt: UserPromptSubmit starts a
// fresh turn (`turns/main-<session_id>.json`), Stop closes it and feeds the `<repo>/main` envelope.
// Free rules only, no judge (a person is there to press Esc): one redirect line, then a systemMessage.
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
// No model call, no git, no transcript read on a call. Every failure answers `{}` and adds a line to
// `.grimoire/economy/errors.log`. `GRIMOIRE_ECONOMY=0` in the session's environment turns it off; so
// does `economy.loopGuard: "off"` in grimoire.config.json, read once per agent. One agent's parallel
// calls fold one at a time, under a per-agent lock. The wrapper (economy.sh) answers the main
// session's events without starting node unless the config sets "on".
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, appendFileSync, readdirSync, statSync, rmdirSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, economyDir } from '../../scripts/economy/paths.mjs'
import { loadConfig, mainCheckout } from '../../scripts/project-config.mjs'
import { newTurn, foldCall, resolved, freeVerdict, wantsJudge, decide, verificationState } from '../../scripts/economy/loopguard/turn.mjs'
import { recentDigest } from '../../scripts/economy/loopguard/state.mjs'
import { DEFAULT_THRESHOLDS, nudgeText } from '../../scripts/economy/loopguard/rules.mjs'
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
const MAIN_TYPE = 'main' // the main session's role: <repo>/main
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// a judge's text, as one line of bounded length with no backticks or control characters: it is model-written,
// it goes into an agent's context, and it must not forge the BLOCKED line's `STUCK WATCH` marker
const oneLine = (s, max) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
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

const guardMode = (config) => (isObj(config?.economy) && MODES.has(config.economy.loopGuard) ? config.economy.loopGuard : 'shadow')

// The agent's settings, read once at its first call: the mode, the thresholds and its repo.
function firstLook(root, cwd) {
  const { config } = loadConfig(root)
  const eco = isObj(config?.economy) ? config.economy : {}
  const mode = guardMode(config)
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
  const read = readTranscript(file)
  // a loop dispatch was shown its repo's facts in its brief: the marker there names the ids
  if (!injected) for (const m of String(read.prompt ?? '').matchAll(/<!-- grimoire:facts (\{[^\n]*?\}) -->/g)) {
    // the first marker of a repo is the engine's (it heads the brief); a later one is quoted text
    try { const v = JSON.parse(m[1]); if (typeof v.repo === 'string' && Array.isArray(v.ids) && !Object.hasOwn(injected ?? {}, v.repo)) (injected ??= {})[v.repo] = v.ids.filter((x) => typeof x === 'string') } catch {}
  }
  for (const c of read.calls) {
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

// One call: folded under its agent's lock (parallel calls run concurrent hooks), and what to answer.
function onCall(dir, root, payload, id, now) {
  mkdirSync(join(dir, 'turns'), { recursive: true })
  let answer = {}
  const folded = withLock(join(dir, 'turns', `${id}.lock`), () => { answer = foldOne(dir, root, payload, id, now) }, CALL_LOCK_WAIT_MS)
  if (!folded) logError(dir, payload.hook_event_name, `a call of ${id} was not folded: its state stayed locked`, now)
  return answer
}

// The BLOCKED line: `STUCK WATCH <id>:` heads the agent's summary, which the engine routes to its
// resolve rung with the record kept under that id (`judge/<id>.blocked.json`).
const blockedLine = (id, reason) => `Stop now and return BLOCKED. Begin your summary with \`STUCK WATCH ${id}:\`, then say what you tried and give this reason: ${reason}. The automated stuck watch redirected you once and still sees a loop.`

/**
 * One stuck verdict on the ladder, and what this call answers: under "on", the redirect (the judge's
 * text, else the template, read before the segment resets), then the BLOCKED line, as additionalContext;
 * the main session's second verdict is a systemMessage to the person instead. Under shadow, {}.
 */
function act(dir, t, payload, main, why, { reason = '', redirect = '', envelope = null, at }) {
  const said = reason ? `${why}: ${reason}` : why
  const text = t.nudges < 1 ? (redirect || nudgeText(t.st))
    : main ? `grimoire stuck watch: this turn still looks like a loop after a redirect (${why}). If it is not making progress, press Esc to interrupt it.`
      : blockedLine(t.agentId, said)
  const action = decide(t, why, { shadow: t.mode !== 'on', at })
  // a pending request is on a segment that just ended (a redirect) or a ladder that did (a block): a judge
  // must not rule on it again; the new segment writes its own once it reaches the gate
  if (!main) rmSync(join(dir, 'judge', `${t.agentId}.request.json`), { force: true })
  if (action.startsWith('would-')) return {}
  if (main && action === 'block') return { systemMessage: text }
  if (action === 'block') {
    // the record the resolve rung reads (a block keeps its segment: the digest is the one that looped)
    mkdirSync(join(dir, 'judge'), { recursive: true })
    writeJson(join(dir, 'judge', `${t.agentId}.blocked.json`), { v: 1, agentId: t.agentId, agentType: t.agentType, repo: t.repo, segment: t.segment, calls: t.calls, at, reason: said,
      digest: recentDigest(t.st, { envelope, verification: verificationState(t) }) })
  }
  return { hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: text } }
}

function foldOne(dir, root, payload, id, now) {
  const main = id !== payload.agent_id
  const file = join(dir, 'turns', `${id}.json`)
  let t = readJson(file)
  if (isObj(t) && t.off) return {}
  if (!isObj(t) || t.v !== 1) {
    const look = firstLook(root, payload.cwd)
    if (main && look.mode !== 'on') return {} // the main session is watched only under "on": nothing written
    if (look.mode === 'off') { writeJson(file, { v: 1, off: true }); return {} }
    const agentType = main ? MAIN_TYPE : typeof payload.agent_type === 'string' ? payload.agent_type : null
    t = { ...newTurn({ agentId: id, agentType, cwd: payload.cwd ?? null, repo: look.repo, at: now }), mode: look.mode, thr: look.thr }
  }
  t.stopped = false // an agent resumed after it stopped is watched again
  const failed = payload.hook_event_name === 'PostToolUseFailure'
  const resp = payload.tool_response
  const exitCode = failed ? 1 : isObj(resp) && Number.isInteger(resp.exitCode) ? resp.exitCode : null
  foldCall(t, { name: payload.tool_name, args: isObj(payload.tool_input) ? payload.tool_input : {}, result: resultText(payload.tool_name, resp, payload.error), exitCode })
  const role = `${t.repo ?? '-'}/${t.agentType ?? '-'}`
  const envelope = envelopeOf(readJson(join(dir, 'envelope.json'))?.[role]?.resolved, t.thr)
  let answer = {}
  // a judge's verdict on this segment, left by the engine's stuck-judge dispatch (never for the main session)
  const resultFile = join(dir, 'judge', `${id}.result.json`)
  if (!main && existsSync(resultFile)) {
    const v = readJson(resultFile)
    rmSync(resultFile, { force: true })
    if (isObj(v) && v.segment === t.segment && !t.blocked) {
      const conf = Number(v.confidence) || 0
      if (v.stuck === true && conf >= t.thr.judge_confidence) answer = act(dir, t, payload, main, `judge-stuck@${conf.toFixed(2)}`, { reason: oneLine(v.reason, 300), redirect: oneLine(v.redirect, 1200), envelope, at: now })
      else t.events.push({ action: 'spared', reason: v.stuck === false ? 'judge-productive' : 'judge-unsure', calls: t.calls, segment: t.segment, at: now })
    }
  }
  // the free rule acts only past the backstop: short of it, a stuck segment is the judge's to rule on
  if (!t.blocked && freeVerdict(t, envelope, t.thr) === 'backstop') answer = act(dir, t, payload, main, `backstop:${t.calls}>=${Math.round(envelope * t.thr.backstop_mult)}`, { envelope, at: now })
  if (!main && wantsJudge(t, t.thr)) {
    mkdirSync(join(dir, 'judge'), { recursive: true })
    writeJson(join(dir, 'judge', `${id}.request.json`), { v: 1, agentId: id, agentType: t.agentType, repo: t.repo, segment: t.segment, calls: t.calls, at: now,
      digest: recentDigest(t.st, { envelope, verification: verificationState(t) }) })
    t.lastRequestAt = t.st.turns
  }
  t.updatedAt = now
  writeJson(file, t)
  return answer
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

// A dispatch or a main-session turn that ended green adds its length to its role's envelope.
function feedEnvelope(dir, t, event, now) {
  if (!resolved(t)) return
  const role = `${t.repo ?? '-'}/${t.agentType ?? '-'}`
  const fed = withLock(join(dir, 'envelope.lock'), () => writeJson(join(dir, 'envelope.json'), withSample(readJson(join(dir, 'envelope.json')), role, t.calls)))
  if (!fed) logError(dir, event, `envelope sample of ${role} (${t.calls} calls) dropped: the lock stayed busy`, now)
}

// States, judge requests and sessions' shown ids older than a week go (an agent that never stopped
// leaves its request, a session that never ended its ids, a turn interrupted with Esc its state).
function sweep(dir, now) {
  for (const sub of ['turns', 'judge', join('facts', 'sessions')]) {
    let names = []
    try { names = readdirSync(join(dir, sub)) } catch {}
    for (const f of names) {
      const p = join(dir, sub, f)
      try { if (f.endsWith('.json') && now - statSync(p).mtimeMs > KEEP_TURNS_MS) rmSync(p, { force: true }) } catch {}
    }
  }
}

// The main session's turn: UserPromptSubmit drops what an interrupted turn left (it never ended
// green), Stop closes the turn, under its lock, feeding the envelope when it ended green.
function onMainTurn(dir, payload, id, now) {
  const file = join(dir, 'turns', `${id}.json`)
  if (payload.hook_event_name === 'UserPromptSubmit') return void rmSync(file, { force: true })
  if (!existsSync(file)) return
  const closed = withLock(join(dir, 'turns', `${id}.lock`), () => {
    const t = readJson(file)
    rmSync(file, { force: true })
    if (isObj(t) && t.v === 1 && !t.off) feedEnvelope(dir, t, 'Stop', now)
  }, CALL_LOCK_WAIT_MS)
  if (!closed) logError(dir, 'Stop', `the turn ${id} was not closed: its state stayed locked`, now)
  sweep(dir, now)
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
  feedEnvelope(dir, t, 'SubagentStop', now)
  sweep(dir, now)
}

function logError(dir, event, message, now) {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'errors.log'), `${new Date(now).toISOString()} ${event || '?'} ${String(message).replace(/\s+/g, ' ').slice(0, 300)}\n`)
  } catch {}
}

/** One hook call: `{}`, or what the agent (or the person) is told. Throws only on input that is not a hook payload. */
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
  const ev = payload.hook_event_name
  const call = ev === 'PostToolUse' || ev === 'PostToolUseFailure'
  if (typeof payload.agent_id === 'string') {
    if (!AGENT_ID.test(payload.agent_id)) return {}
    const root = projectRoot({ env, cwd: payload.cwd })
    const dir = economyDir(root)
    if (call) return onCall(dir, root, payload, payload.agent_id, now)
    if (ev === 'SubagentStop') onStop(dir, root, payload, now)
    return {}
  }
  // the main session, keyed per session and closed at each Stop: one turn per prompt
  const sid = payload.session_id
  if (typeof sid !== 'string' || !AGENT_ID.test(sid) || !(call || ev === 'UserPromptSubmit' || ev === 'Stop')) return {}
  const root = projectRoot({ env, cwd: payload.cwd })
  const dir = economyDir(root)
  const id = `main-${sid}`
  // watched only under "on": a turn's state exists only then (the wrapper filters these events out otherwise)
  if (call && !existsSync(join(dir, 'turns', `${id}.json`)) && guardMode(loadConfig(root).config) !== 'on') return {}
  if (call) return onCall(dir, root, payload, id, now)
  onMainTurn(dir, payload, id, now)
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
