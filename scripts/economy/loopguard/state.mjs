// grimoire · economy · loopguard · state: one dispatch's failure-loop signals, folded one tool call
// at a time. Counts and a short, leakage-safe action log only: edits per file, files edited, error
// outputs, verification runs, and how often a failure repeats one seen before (`stagnation`, the
// signal that separates a loop from a hard but productive grind). Never file contents.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/loopguard/state.py (commit 1deb887,
// Apache-2.0): the regexes, the tool canon, the failure signature and the fold are its own; the
// Copilot and Codex stream schemas are left out (grimoire reads Claude Code's only).
import { createHash } from 'node:crypto'

// An output that RAN code to verify behaviour (the test step of the edit→test loop).
export const TEST_RUN_RE = /(runtests(\.py)?|\bpytest\b|py\.test|manage\.py\s+test|python\s+-m\s+unittest|\btox\b|\bnox\b|\btrial\b|python\d?\s+-c\b)/i
// An output carrying a failure marker. Go's `--- FAIL: `, `FAIL\t` and a bare `FAIL` line are matched
// case-sensitively (the source's `(?-i:…)`), so unittest's `FAIL: test_x` is not one of them.
const ERR_I = /(Traceback \(most recent call last\)|\b\w*Error\b|\bFAILED\b|\bassert\b|Exception|errors during collection|^# fail [1-9]|^not ok \d|\b[1-9]\d* (?:failing|failures?)\b|Failures: [1-9])/im
const ERR_CS = /^(?:--- FAIL: |FAIL\t|FAIL$)/m
export const errMatch = (text) => ERR_I.test(text) || ERR_CS.test(text)

const EDIT_TOOLS = new Set(['edit', 'str_replace', 'create'])
// Tools whose output is the content of files, not the outcome of running anything: a test file full
// of `assert` read back is no failure, nor is reading it twice a repeated one.
const CONTENT_TOOLS = new Set(['view', 'grep', 'glob'])
const CANON = { bash: 'bash', shell: 'bash', read: 'view', view: 'view', grep: 'grep', glob: 'glob', edit: 'edit', multiedit: 'edit', str_replace: 'edit', apply_patch: 'edit', write: 'create', create: 'create' }

/** Claude Code's tool names onto the canon the fold keys on; unknown names pass through. */
export const canonTool = (name) => { const k = String(name || '').toLowerCase(); return Object.hasOwn(CANON, k) ? CANON[k] : name || '?' }
export const basename = (p) => (p ? String(p).replace(/\/+$/, '').split('/').pop() : p || '')
// rtk rewrites `cmd` to `rtk cmd` (and `rtk proxy cmd`): classify the command it runs
export const stripRtk = (cmd) => (typeof cmd === 'string' ? cmd.replace(/^\s*rtk(?:\s+proxy)?\s+/, '') : cmd)

/** A normalized signature of a failing output: its first failure line, with numbers, hex and paths dropped, hashed. */
export function failureSig(text) {
  if (!text) return null
  const first = String(text).split(/\r\n|\r|\n/).find((l) => errMatch(l)) // Python's splitlines: a lone \r ends a line too
  if (first === undefined) return null
  const norm = first.replace(/0x[0-9a-f]+|\d+|\/\S+/g, '').trim()
  return createHash('md5').update(norm, 'utf8').digest('hex').slice(0, 10)
}

// a count kept under a file's name: own keys only, so a file named `constructor` counts like any other
const count = (o, k) => (Object.hasOwn(o, k) ? o[k] : 0)

export const newState = () => ({ turns: 0, editCounts: {}, editOrder: [], errorOutputs: 0, testRuns: 0, failSigs: {}, repeatedFailSigs: 0, recent: [] })
export const editChurn = (s) => Math.max(0, ...Object.values(s.editCounts))
export const distinctEditFiles = (s) => Object.keys(s.editCounts).length
export function stagnation(s) {
  const total = Object.values(s.failSigs).reduce((a, b) => a + b, 0)
  return total ? s.repeatedFailSigs / total : 0
}

/**
 * Fold one completed tool call. `failed`: true for a tool error or a non-zero exit, false for a
 * success, null when unknown; a content tool's output is a failure only when the tool itself
 * failed, a call known to have succeeded never is, and otherwise the output's markers decide.
 */
export function update(s, toolName, args, resultText, failed = null) {
  s.turns++
  args = args && typeof args === 'object' ? args : {}
  const tool = canonTool(toolName)
  let action = tool || '?'
  if (EDIT_TOOLS.has(tool)) {
    const b = basename(args.path || args.filePath || args.file_path || '')
    if (b) {
      s.editOrder.push(b)
      s.editCounts[b] = count(s.editCounts, b) + 1
      action = `edit ${b}`
    }
  }
  const cmd = tool === 'bash' && typeof args.command === 'string' ? stripRtk(args.command) : ''
  if (cmd) {
    action = `$ ${cmd.trim().replace(/\s+/g, ' ').slice(0, 90)}`
    if (TEST_RUN_RE.test(cmd)) s.testRuns++
  } else if (tool === 'grep' || tool === 'glob') action = `${tool} ${String(args.pattern || '').slice(0, 40)}`
  else if (tool === 'view') action = `view ${basename(args.path || args.file_path || '')}`
  let fail = null
  const canFail = CONTENT_TOOLS.has(tool) ? failed === true : failed !== false
  if (resultText && canFail && errMatch(resultText)) {
    s.errorOutputs++
    const sig = failureSig(resultText)
    if (sig) {
      fail = sig
      if (Object.hasOwn(s.failSigs, sig)) s.repeatedFailSigs++
      s.failSigs[sig] = count(s.failSigs, sig) + 1
    }
  }
  s.recent.push(`${String(s.turns).padStart(3)}: ${action}${fail ? `  [err#${fail}]` : ''}`)
  if (s.recent.length > 40) s.recent = s.recent.slice(-40)
}

/** Count `names` (from shell-edits) as edits, and say so in the action log. */
export function foldShellEdits(s, names) {
  for (const b of names) {
    s.editOrder.push(b)
    s.editCounts[b] = count(s.editCounts, b) + 1
  }
  if (names.length && s.recent.length) s.recent[s.recent.length - 1] += `  [edits ${names.slice(0, 4).join(', ')}${names.length > 4 ? ', ...' : ''}]`
}

export const snapshot = (s) => ({ turns: s.turns, edit_churn: editChurn(s), distinct_edit_files: distinctEditFiles(s), error_outputs: s.errorOutputs, test_runs: s.testRuns, stagnation: Math.round(stagnation(s) * 1000) / 1000, repeated_fail_sigs: s.repeatedFailSigs })

/** What the stuck judge reads: counts and the recent actions (commands, searches, edited basenames, failure signatures), never content. */
export function recentDigest(s, { n = 24, envelope = null, verification = null } = {}) {
  let head = `turns=${s.turns} edit_churn=${editChurn(s)} distinct_edit_files=${distinctEditFiles(s)} error_outputs=${s.errorOutputs} test_runs=${s.testRuns} repeated_identical_failures=${s.repeatedFailSigs} stagnation=${stagnation(s).toFixed(2)}`
  if (envelope) head += `\nrepo_context: dispatches of this role here usually end green within ~${Math.round(envelope)} tool calls; this one is at ${s.turns} = ${(s.turns / envelope).toFixed(1)}x that. ${verification || ''} A dispatch far past the usual length with recurring failures is likely a dead-end loop, even if it touches many files.`
  else if (verification) head += `\n${verification}`
  return `${head}\nRecent actions (oldest->newest):\n${s.recent.slice(-n).join('\n')}`
}
