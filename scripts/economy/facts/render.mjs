// grimoire · economy · facts · render: the block a session starts with. Each injectable fact is one
// declarative line whose every specific string (an interpreter path, a runner form, a refused host)
// is a parameter learned from earlier sessions. The block holds at most MAX_FACTS facts in about
// MAX_CHARS characters (~150 tokens, header included), in priority order; form-repair facts whose
// working forms share a root merge into one line; and a lint refuses any line that reads as
// completion or verification advice.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/microskills/envfacts.py (commit 1deb887,
// Apache-2.0): `EnvFact.claim` and `working_form`, `EnvFactsDistiller._select` and `_merged_lines`,
// `lint_ok`. The header is the plugin's (`GENERIC_HEADER`); the experiments' per-task header and
// `injectable_claims` (what a paid proposer stacked on top is told not to restate) are left out.
import { REDACTED } from './observe.mjs'
import { firingRate, injectable } from './lifecycle.mjs'

export const MAX_FACTS = 4
export const MAX_CHARS = 600 // the source's MAX_TOKENS = 150, at ~4 characters per token
export const HEADER = '# environment facts learned from earlier sessions in this repository'

// words that would turn a fact into completion or verification advice
const LINT_RE = /\b(skip|no need|don'?t|do not|stop|done|completed?|finish(?:ed)?|verify|verification|instead of (?:running|testing))\b/i
const ERROR_PHRASE = {
  module_missing: 'ModuleNotFoundError',
  command_missing: 'command not found',
  script_missing: 'a file-not-found error',
  usage_error: 'a usage error',
  permission_denied: 'permission denied',
}
const PRIORITY = { form_repair: 0, arg_repair: 1, env_value: 2, empty_probe: 3, boundary: 4 }
const phrase = (e) => (Object.hasOwn(ERROR_PHRASE, e) ? ERROR_PHRASE[e] : e)

export const lintOk = (text) => !LINT_RE.test(text || '')

/** The key with the highest count (the first one among ties), or null. */
export function best(counts) {
  let key = null, n = -Infinity
  for (const [k, v] of Object.entries(counts || {})) if (v > n) { key = k; n = v }
  return key
}

/** Most common first, ties in insertion order (Python's Counter.most_common). */
const mostCommon = (counts, k) => Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, k).map(([h]) => h)

const movesShell = (form) => form.startsWith('cd ') && form.includes(' && ')

/** A form as a claim shows it. One that starts with `cd DIR &&` is shown as a subshell: an agent whose
 * shell keeps its directory between calls (Claude Code) that typed the bare `cd` would run every later
 * command in DIR, where the next `cd DIR` fails. */
export const usage = (form, args = ' …') => (movesShell(form) ? `\`(${form}${args})\`` : `\`${form}${args}\``)

export function join(items) {
  if (!items.length) return 'the hosts it tried'
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// The part of a working form that carries the environment: its activation prefix, or the directory of
// its explicit path.
function rootOf(form) {
  if (form.includes(' && ')) return form.split(' && ', 1)[0]
  if (['conda run', 'poetry run', 'pipenv run', 'uv run', 'npx'].some((p) => form.startsWith(p))) return form.split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  const head = form ? (form.split(/\s+/).filter(Boolean)[0] ?? '') : ''
  return head.includes('/') ? head.slice(0, head.lastIndexOf('/')) : head
}

/** The working form a form-repair fact names: the one with the best record, sessions it worked in as
 * typed less sessions it failed in, among those that leave the shell where it is (`python
 * tests/runtests.py`, not `cd tests && python runtests.py`) whenever one of them has a good record at
 * all. Null when no form has: then the fact makes no claim. */
export function workingForm(fact) {
  const c = fact.params.bCounts || {}
  const bad = fact.params.bFails || {}
  const net = {}
  for (const [k, v] of Object.entries(c)) if (v > (bad[k] ?? 0)) net[k] = v - (bad[k] ?? 0)
  const still = Object.fromEntries(Object.entries(net).filter(([k]) => !movesShell(k)))
  const pool = Object.keys(still).length ? still : net
  let pick = null
  for (const k of Object.keys(pool)) if (pick === null || pool[k] > pool[pick] || (pool[k] === pool[pick] && c[k] > c[pick])) pick = k
  return pick
}

/** The one-line claim a fact makes ('' when it makes none). */
export function claim(fact) {
  const p = fact.params
  switch (fact.family) {
    case 'form_repair': {
      const b = workingForm(fact)
      if (b === null) return ''
      const e = best(p.errorCounts) || 'module_missing'
      return `${usage(p.a)} fails here with ${phrase(e)}; ${usage(b)} works.`
    }
    case 'boundary':
      return `Outbound connections to ${join(mostCommon(p.hosts, 3))} are refused here; nothing can be fetched from them.`
    case 'arg_repair': {
      if (p.kind === 'sep') return `${usage(p.form, '')} takes dotted test labels (\`module.Class.test\`, not \`module::Class::test\`).`
      const keys = Object.keys(p.examples || {})
      const pairs = (keys.length ? keys : ['x x']).map((k) => { const i = k.indexOf(' '); return i < 0 ? [k] : [k.slice(0, i), k.slice(i + 1)] })
      let [a, b] = pairs[0]
      for (const pr of pairs) if (pr[0].length < a.length) [a, b] = pr
      return `${usage(p.form, '')} takes test labels without the \`${p.param}\` prefix (\`${b}\`, not \`${a}\`).`
    }
    case 'env_value': {
      const good = best(p.good) || ''
      // a value that may be a secret is never recorded: the fact names the variable only
      if (good === REDACTED) return `Code that imports the project needs \`${p.var}\` set here (its value is not recorded).`
      const bad = Object.keys(p.bad || {}).sort().filter((v) => v !== good && v !== REDACTED).slice(0, 1)
      return `Code that imports the project needs \`${p.var}\` set here: \`${p.var}=${good}\` works` + (bad.length ? `, \`${bad[0]}\` does not.` : '.')
    }
    case 'empty_probe':
      return 'This checkout has no git remote and no branches, tags or unreachable objects beyond HEAD; its history ends at the checked-out commit.'
    default:
      return ''
  }
}

/** Form-repair facts whose working forms share a root (the same activation prefix or the same
 * directory) collapse into one line: they are one environment fact. */
export function mergedLines(facts) {
  const lines = []
  const groups = new Map()
  for (const f of facts) {
    if (f.family === 'form_repair') {
      const k = rootOf(workingForm(f) || '')
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(f)
    } else lines.push(claim(f))
  }
  for (const fs of groups.values()) {
    if (fs.length === 1) { lines.unshift(claim(fs[0])); continue }
    const aForms = join(fs.map((f) => usage(f.params.a)))
    // an error with no phrase is left out here (the claim alone spells it as its class)
    const errs = [...new Set(fs.map((f) => ERROR_PHRASE[best(f.params.errorCounts)]))].filter(Boolean).sort()
    const bs = [...new Set(fs.map((f) => usage(workingForm(f))))].sort()
    lines.unshift(`${aForms} fail here (${errs.join(', ') || 'environment error'}); ${join(bs)} ${bs.length === 1 ? 'works' : 'work'}.`)
  }
  return lines
}

/** The facts the block holds now, in priority order: form repair (a running interpreter first), arg
 * repair, env value, empty probe, boundary, then the highest firing rate. A fact whose line would push
 * the block past `maxChars` is passed over for a shorter one; the block stops at `maxFacts`. */
export function select(facts, { maxFacts = MAX_FACTS, maxChars = MAX_CHARS } = {}) {
  const cands = facts.filter((f) => { const c = injectable(f.life) && claim(f); return c && lintOk(c) })
  const rank = (f) => [PRIORITY[f.family] ?? 9, f.params.intent === 'run_interpreter' ? 0 : 1, -firingRate(f.life)]
  cands.sort((x, y) => { const a = rank(x), b = rank(y); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 })
  let chosen = []
  for (const f of cands) {
    const trial = [...chosen, f]
    if (trial.length > maxFacts) break
    if ([HEADER, ...mergedLines(trial).map((t) => `- ${t}`)].join('\n').length > maxChars) continue
    chosen = trial
  }
  return chosen
}

/** The block for these facts: the header and one `- ` line each ('' for none). */
export function blockText(facts) {
  if (!facts.length) return ''
  return [HEADER, ...mergedLines(facts).map((t) => `- ${t}`)].join('\n') + '\n'
}
