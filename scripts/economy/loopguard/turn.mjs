// grimoire · economy · loopguard · turn: one dispatched agent watched across its tool calls, persisted
// between hook calls as plain JSON (`.grimoire/economy/turns/<agent_id>.json`) and replayed offline
// the same way (scripts/economy/replay.mjs).
//   • foldCall    — one completed call into the segment and whole-dispatch states, with the shell's
//                   edits, and a test run's real verdict when a pipe or `||` replaced its status
//   • resolved    — did the dispatch END GREEN: no failed verification after its last edit
//   • freeVerdict — what the free rules say (no judge): stuck past the backstop, or past the envelope
//   • decide      — the ladder: a first stuck verdict redirects and starts a fresh segment, a later
//                   one blocks; in shadow mode it is only recorded as would-redirect / would-block
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/loopguard/turn.py (commit 1deb887,
// Apache-2.0): fold, _track, resolved_proxy, verification_state and the nudge-then-stop ladder.
import { newState, update, foldShellEdits, canonTool, stripRtk, errMatch } from './state.mjs'
import { shellEditTargets } from './shell-edits.mjs'
import { DEFAULT_THRESHOLDS, gateForJudge, isStuck, statusOfTests, runnerVerdict, VERIFY_RE } from './rules.mjs'

export const JUDGE_GAP = 5 // calls between two judge requests of one segment

export const newTurn = ({ agentId = null, agentType = null, cwd = null, repo = null, at = null } = {}) => ({
  v: 1, agentId, agentType, cwd, repo, st: newState(), whole: newState(), calls: 0, segment: 0, nudges: 0, blocked: false,
  lastEdit: 0, lastVerify: 0, lastVerifyFailed: false, edits: 0, verifications: 0, lastRequestAt: null, events: [], stopped: false, startedAt: at, updatedAt: at,
})

/** Fold one completed call. `exitCode`: 0, non-zero, or null when the agent reported none (Claude Code's case). */
export function foldCall(t, { name, args = {}, result = '', exitCode = null }) {
  const cmd = canonTool(name) === 'bash' && typeof args.command === 'string' ? stripRtk(args.command) : null
  const shellEdits = cmd !== null ? shellEditTargets(cmd) : []
  const status = statusOfTests(cmd)
  if (status === 'hidden' || status === 'mixed') {
    const v = runnerVerdict(result)
    if (v !== null) exitCode = v ? 1 : 0
    else if (status === 'hidden') exitCode = null
  }
  const failed = exitCode === null ? null : exitCode !== 0
  update(t.st, name, args, result || '', failed)
  update(t.whole, name, args, result || '', failed)
  foldShellEdits(t.st, shellEdits)
  foldShellEdits(t.whole, shellEdits)
  t.calls++
  track(t, name, cmd, result, exitCode, shellEdits)
}

function track(t, name, cmd, result, exitCode, shellEdits) {
  const canon = canonTool(name)
  if (canon === 'edit' || canon === 'create') { t.lastEdit = t.calls; t.edits++; return }
  const verifies = typeof cmd === 'string' && VERIFY_RE.test(cmd)
  if (shellEdits.length) { t.lastEdit = t.calls - (verifies ? 1 : 0); t.edits++ } // `sed -i … && pytest`: the edit comes first
  if (verifies) {
    t.lastVerify = t.calls
    t.verifications++
    t.lastVerifyFailed = exitCode !== null ? exitCode !== 0 : errMatch(result || '')
  }
}

/** Did the dispatch end green: green unless a verification after its last edit failed. */
export function resolved(t, stoppedNormally = true) {
  if (!stoppedNormally || t.blocked || !t.calls) return false
  return !(t.lastVerifyFailed && t.lastVerify > t.lastEdit)
}

/** How the last verification went, for the judge's digest. */
export function verificationState(t) {
  if (!t.verifications) return 'No test or verification run has been seen in this dispatch.'
  return `The last verification run ${t.lastVerifyFailed ? 'failed' : 'passed'}.${t.lastEdit > t.lastVerify ? ' There have been edits since.' : ''}`
}

/**
 * What the free rules say: 'backstop' (the segment is stuck and the whole dispatch is past
 * backstop_mult × the envelope), 'envelope' (the segment is stuck and itself past the envelope), or
 * null. The source compares the backstop to the dispatch's calls and the envelope to the segment's.
 */
export function freeVerdict(t, envelope, thr = DEFAULT_THRESHOLDS) {
  if (envelope === null || envelope === undefined || !isStuck(t.st, thr)) return null
  if (t.calls >= envelope * thr.backstop_mult) return 'backstop'
  return t.st.turns >= envelope ? 'envelope' : null
}

/** Should a judge request go out now: the gate is open and JUDGE_GAP calls passed since the last one of this segment. */
export function wantsJudge(t, thr = DEFAULT_THRESHOLDS) {
  if (t.blocked || !gateForJudge(t.st, thr)) return false
  return t.lastRequestAt === null || t.st.turns - t.lastRequestAt >= JUDGE_GAP
}

/**
 * Apply one stuck verdict to the ladder: the first redirects (and a fresh segment starts, the
 * agent's fair window to recover), a later one blocks. Returns the action — 'redirect' or 'block',
 * prefixed 'would-' in shadow mode — after recording it in t.events.
 */
export function decide(t, reason, { shadow = true, at = null } = {}) {
  const act = t.nudges < 1 ? 'redirect' : 'block'
  const action = shadow ? `would-${act}` : act
  t.events.push({ action, reason, calls: t.calls, segment: t.segment, at })
  if (t.events.length > 20) t.events = t.events.slice(-20)
  if (act === 'redirect') { t.nudges++; t.segment++; t.st = newState(); t.lastRequestAt = null } else t.blocked = true
  return action
}
