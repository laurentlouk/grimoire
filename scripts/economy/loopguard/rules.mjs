// grimoire · economy · loopguard · rules: when a dispatch looks stuck, from its folded state alone.
//   • gateForJudge — free, every call: is the recent trace worth a paid look at all?
//   • isStuck      — the strict heuristic: churn or scatter, AND sustained errors, AND repeated
//                    identical failures (the last is what spares a productive hard grind)
//   • nudgeText    — the redirect template: the agent's own actions mirrored back, never "stop"
// Plus what a command line's exit status says of the test runs in it (`statusOfTests`) and what a
// runner's own summary says (`runnerVerdict`), for a run whose status a pipe or `||` replaced.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/loopguard/rules.py and turn.py (commit
// 1deb887, Apache-2.0): DEFAULT_THRESHOLDS, the gate, is_stuck, nudge_text, VERIFY_RE,
// status_of_tests and runner_verdict. The judge cascade (assess_abort) is not ported: grimoire's
// judge is a dispatch the engine makes (token economy slice 4), not a call from the hook.
import { editChurn, distinctEditFiles, stagnation } from './state.mjs'

export const DEFAULT_THRESHOLDS = Object.freeze({
  min_turns: 20, // don't judge stuck before the loop has run a while
  edit_churn: 4, // ≥ 4 edits to one file
  distinct_edit_files: 3, // or edits scattered across ≥ 3 files
  error_outputs: 6, // sustained error density
  stagnation: 0.2, // ≥ 20 % of failures repeat an earlier one
  envelope_margin: 1.25, // the envelope is margin × the pct-th percentile of runs that ended green
  envelope_pct: 90,
  envelope_min_samples: 5, // no envelope before 5 dispatches of the role ended green
  judge_confidence: 0.7, // a stuck verdict counts at this confidence or more
  backstop_mult: 2.5, // stuck and past this multiple of the envelope: no judge needed
  gate_min_turns: 18, // the gate to the judge: after this many calls…
  gate_error_outputs: 8, // …a repeated failure, or this many error outputs
})

/** Worth a paid look? After gate_min_turns calls: a repeated identical failure, or many error outputs. */
export function gateForJudge(s, thr = DEFAULT_THRESHOLDS) {
  if (s.turns < thr.gate_min_turns) return false
  return s.repeatedFailSigs >= 1 || s.errorOutputs >= thr.gate_error_outputs
}

/** The strict heuristic: run a while, AND churn or scatter, AND sustained errors, AND repetition. */
export function isStuck(s, thr = DEFAULT_THRESHOLDS) {
  if (s.turns < thr.min_turns) return false
  const churny = editChurn(s) >= thr.edit_churn || distinctEditFiles(s) >= thr.distinct_edit_files
  return churny && s.errorOutputs >= thr.error_outputs && stagnation(s) >= thr.stagnation
}

/** The redirect: the agent's own repeated actions mirrored back, framed to redirect effort, never to stop. */
export function nudgeText(s) {
  const busiest = Object.entries(s.editCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'one file'
  const edits = Object.values(s.editCounts).reduce((a, b) => a + b, 0)
  return `Process check (automated): so far you've made ${edits} edits across ${distinctEditFiles(s)} file(s) (most to \`${busiest}\`) and run ${s.testRuns} verification(s), and the same failure has recurred ${s.repeatedFailSigs} time(s) without the tests going green. This looks like a repetitive loop. Do NOT stop — instead step back and try a MATERIALLY DIFFERENT hypothesis: re-read the failing test's expectation, consider a different file or root cause than the ones you've been editing, and verify the new hypothesis directly before editing again.`
}

// What counts as running the project's own checks, across ecosystems: only for the ended-green
// proxy and for reading a run whose status was replaced, never for what the state counts.
const VERIFY_SRC = String.raw`(?:^|[\s;&|(])(?:~?\/)?(?:[\w.\-]+\/)*(?:pytest|py\.test|tox|nox|python\d?(?:\.\d+)?\s+-m\s+(?:pytest|unittest)|manage\.py\s+test|runtests(?:\.py)?|jest|vitest|mocha|ava|playwright\s+test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|go\s+test|cargo\s+(?:test|nextest)|(?:mvn|mvnw|\.\/mvnw)\s+(?:\S+\s+)*test|(?:gradle|gradlew|\.\/gradlew)\s+(?:\S+\s+)*test|make\s+(?:test|check)|ctest|rspec|phpunit|dotnet\s+test|swift\s+test|mix\s+test|deno\s+test|node\s+--test|bazel\s+test|(?:\.\/)?bin\/test)(?![\w.\-\/])`
export const VERIFY_RE = new RegExp(VERIFY_SRC, 'i')
const VERIFY_AT_START = new RegExp(`^${VERIFY_SRC}`, 'i')

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g
const SEP = /(&&|\|\||\|&|(?<!>)\||;|\n)/
const NOT_A_RUN = /\s(?:-h|--help|--version|--collect-only|--co|--list\S*)(?!\S)/
const PREFIX = /^\s*(?:(?:\w+=\S*|time|nice|nohup|command|env|timeout(?:\s+(?:-\S+|[A-Z]+|\d\S*))+)\s+)*/
const REPORT = /^\s*(?:echo|printf|true|:|exit)(?:\s|$)/
const RANK = { own: 0, hidden: 1, mixed: 2 }

// POSIX word splitting, enough to see `bash -lc '<script>'`; null on an unbalanced quote.
function posixWords(cmd) {
  const out = []
  let cur = null, i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null } i++; continue }
    cur ??= ''
    if (c === "'") { const e = cmd.indexOf("'", i + 1); if (e < 0) return null; cur += cmd.slice(i + 1, e); i = e + 1; continue }
    if (c === '"') {
      let j = i + 1
      for (; j < cmd.length && cmd[j] !== '"'; j++) { if (cmd[j] === '\\' && j + 1 < cmd.length) { cur += cmd[++j]; continue } cur += cmd[j] }
      if (j >= cmd.length) return null
      i = j + 1; continue
    }
    if (c === '\\' && i + 1 < cmd.length) { cur += cmd[i + 1]; i += 2; continue }
    cur += c; i++
  }
  if (cur !== null) out.push(cur)
  return out
}

/**
 * What `cmd`'s exit status says of the test runs in it: null when it runs none; "own" when it is
 * theirs (a run is last, or followed only by `&&`, or piped under pipefail); "hidden" when a pipe,
 * `||` or a mere report of the status replaced it; "mixed" when other commands ran after, their
 * output in the result too.
 */
export function statusOfTests(cmd) {
  if (typeof cmd !== 'string') return null
  const parts = posixWords(cmd) || []
  if (parts.length >= 3 && SHELLS.has(parts[0].split('/').pop()) && parts[1].startsWith('-') && parts[1].includes('c')) cmd = parts[2]
  const pieces = cmd.replace(QUOTED, 'Q').replace(/[(){}]/g, ' ').split(SEP)
  while (pieces.length > 1 && !pieces[pieces.length - 1].trim()) pieces.splice(-2, 2) // a trailing `;` or newline
  const pipefail = cmd.includes('pipefail')
  let found = null
  for (let i = 0; i < pieces.length; i += 2) {
    const stage = pieces[i]
    if (!VERIFY_AT_START.test(stage.replace(PREFIX, '')) || NOT_A_RUN.test(stage)) continue
    let status = 'own'
    for (let k = i + 1; k + 1 < pieces.length; k += 2) {
      const sep = pieces[k], then = pieces[k + 1]
      if (sep === '&&' || (pipefail && (sep === '|' || sep === '|&'))) continue
      if (sep === '|' || sep === '|&' || sep === '||') { status = 'hidden'; break }
      if (!REPORT.test(then)) { status = 'mixed'; break }
      status = 'hidden'
    }
    if (found === null || RANK[status] > RANK[found]) found = status
  }
  return found
}

const RUN_FAILED = new RegExp([
  String.raw`\b[1-9]\d* (?:failed|errors?)\b.*\bin \d+(?:\.\d+)?s\b`, // pytest
  String.raw`^FAILED \((?:failures|errors)=`, // unittest, Django
  String.raw`^tests finished:.*\b[1-9]\d* (?:failed|exceptions?)\b`, // sympy's bin/test
  String.raw`^# fail [1-9]`, // TAP (node --test)
  String.raw`^Tests:.*\b[1-9]\d* failed\b`, // jest
  String.raw`^\s*Tests\s+[1-9]\d* failed\b`, // vitest
  String.raw`^\s*[1-9]\d* failing\b`, // mocha
  String.raw`^(?:--- FAIL: |FAIL\t|FAIL$)`, // go
  String.raw`^test result: FAILED`, // cargo
  String.raw`\b\d+ examples?, [1-9]\d* failures?\b`, // rspec
  String.raw`Tests run: \d+, Failures: (?:[1-9]|0, Errors: [1-9])`, // JUnit
  String.raw`BUILD FAIL(?:URE|ED)`,
].join('|'), 'm')
const RUN_PASSED = new RegExp([
  String.raw`\b\d+ passed\b.*\bin \d+(?:\.\d+)?s\b`, String.raw`^OK(?: \(.*\))?\s*$`, String.raw`^tests finished: \d+ passed`, String.raw`^# fail 0\b`,
  String.raw`^Tests:\s+\d+ passed`, String.raw`^\s*Tests\s+\d+ passed`, String.raw`^\s*\d+ passing\b`, String.raw`^ok\s+\S+\s+(?:\d+(?:\.\d+)?s|\(cached\))`,
  String.raw`^test result: ok\.`, String.raw`\b\d+ examples?, 0 failures\b`, String.raw`BUILD SUCCESS`,
].join('|'), 'm')

/** true when a test runner's summary in `text` says its run failed, false when one says it passed, null when there is none. */
export function runnerVerdict(text) {
  if (!text) return null
  if (RUN_FAILED.test(text)) return true
  return RUN_PASSED.test(text) ? false : null
}
