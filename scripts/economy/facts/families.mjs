// grimoire · economy · facts · families: environment facts learned for free from recurring failures.
// As a repository's dispatches and sessions finish, `update` looks for recurring shapes of evidence
// that an agent rediscovers the same environment fact by failing at it, session after session. When a
// shape recurs, it becomes a one-line declarative fact that `render` injects at the start of the next
// session. No model is involved.
//
// The families:
//   form repair  form A of an intent (run the interpreter, the tests, a build, the package tool) fails
//                with an infrastructure error and a later form B succeeds. "`A …` fails here with
//                <error>; `B …` works." Contradicted when the bare form runs the test runner (two
//                exercised sessions in a row).
//   arg repair   the runner cannot load a label of one shape and, run the same way, loads it rewritten
//                (a leading package prefix dropped, `::` written as `.`). A label naming something that
//                does not exist matches neither rewrite, so a plain mistake never becomes a fact.
//   env value    code fails asking for an environment variable by name, and a later run that sets it
//                succeeds. Contradicted when that value fails the same way.
//   boundary     fetches to hosts fail with a network error. High stakes: retires the moment a fetch
//                to a listed host succeeds.
//   empty probe  VCS probes beyond the checkout (remotes, other branches, newer tags, unreachable
//                objects) come back empty. High stakes: retires the moment one returns something.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/microskills/envfacts.py (commit 1deb887,
// Apache-2.0): `EnvFactsDistiller.update`, `fold`, `typed_ok`, `_repairs`, the store and the
// injected-ids handshake. Left out: the LLM proposer (`distiller.py`) and everything that calls a
// model (`runner`, `model`), the experiments' vocabularies and header, the file-path persistence
// (`save`/`load`: the caller owns where the store lives and its lock) and the telemetry row. The input
// is grimoire's call list instead of a transcript path.
import { observeCalls, formFailed, formWorked, isBare, labelRule, NETWORK_ERRORS } from './observe.mjs'
import { newLife, updateLife } from './lifecycle.mjs'
import { select, blockText, best } from './render.mjs'

export const CONTRADICT_STREAK = 2 // form repair: consecutive contradicted folds before one counts

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const inc = (o, k, n = 1) => { o[k] = (Object.hasOwn(o, k) ? o[k] : 0) + n }
const uniq = (xs) => [...new Set(xs)]

// What one process knows about the session it renders for and folds (the source keeps it in memory,
// never in the saved store): non-enumerable, so JSON.stringify(store) and toJSON(store) leave it out.
function sessionFields(store) {
  Object.defineProperty(store, 'lastInjected', { value: [], writable: true, enumerable: false, configurable: true })
  Object.defineProperty(store, 'lastDigest', { value: null, writable: true, enumerable: false, configurable: true })
  return store
}

/** An empty store for one repository. `now` counts the folds: a fact's age, for its score's decay. */
export const newStore = (repo) => sessionFields({ repo: String(repo ?? ''), now: 0, vocab: 'generic', facts: {} })

/** The store as it is saved. */
export const toJSON = (store) => ({ repo: store.repo, now: store.now, vocab: store.vocab, facts: store.facts })

const validFact = (f) => isObj(f) && typeof f.id === 'string' && typeof f.family === 'string' && isObj(f.params) && isObj(f.life) &&
  Array.isArray(f.life.confirms) && Array.isArray(f.life.contradicts)

/** A store read back from its JSON (an object or a string). A malformed file or fact is dropped, never
 * thrown: the facts are re-learned. */
export function fromJSON(data, repo = null) {
  let d = data
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = null } }
  const store = newStore(repo ?? (isObj(d) && typeof d.repo === 'string' ? d.repo : ''))
  if (!isObj(d)) return store
  if (Number.isInteger(d.now) && d.now >= 0) store.now = d.now
  for (const [k, f] of Object.entries(isObj(d.facts) ? d.facts : {})) {
    if (!validFact(f) || f.id !== k) continue
    f.life.drift = false // an environment fact holds or not whatever files a session edits
    store.facts[k] = f
  }
  return store
}

const newFact = (id, family, high, params) => ({
  id, family, params,
  // An environment fact holds or not whatever files a session edits: in a small repository where
  // every session touches the same module, three sessions missing `pytest` are three confirmations.
  life: newLife(high, false),
})

/** The block the next session starts with ('' when nothing is injectable); remembers which facts it
 * chose (`injectedIds`). Options: `maxFacts`, `maxChars`. */
export function render(store, opts = {}) {
  const chosen = select(Object.values(store.facts), opts)
  store.lastInjected = chosen.map((f) => f.id)
  return blockText(chosen)
}

/** The ids of the facts the last `render` chose: what the next session is given. */
export const injectedIds = (store) => [...(store.lastInjected || [])].sort()

/** Say which facts the session about to be folded was actually given. A caller that renders in one
 * process and folds in another (a session-start hook, then a fold after the session) must, or an
 * injected fact never counts as having fired and decays out of the block while it works. */
export function seedInjected(store, ids) {
  store.lastInjected = uniq((Array.isArray(ids) ? ids : []).filter((i) => typeof i === 'string' && Object.hasOwn(store.facts, i)))
}

/** Fold one fact's verdict. Two adjustments to the shared state machine: a high-stakes CANDIDATE that
 * is contradicted retires at once (the lifecycle hard-kills only ACTIVE facts), and a form-repair
 * contradiction counts only after CONTRADICT_STREAK consecutive exercised folds said so: one session
 * whose tests needed none of the missing packages is not a fixed environment. */
function fold(fact, now, verdict, fired, exercised, files) {
  if (fact.family === 'form_repair' && exercised) {
    const streak = verdict === 'contradict' ? (fact.params.contraStreak ?? 0) + 1 : 0
    fact.params.contraStreak = streak
    if (verdict === 'contradict' && streak < CONTRADICT_STREAK) verdict = null
  }
  updateLife(fact.life, now, verdict, fired, exercised, files)
  if (verdict === 'contradict' && fact.life.high && fact.life.state === 'CANDIDATE') { fact.life.state = 'RETIRED'; fact.life.retiredAt = now }
}

// The form worked exactly as typed: no `VAR=value` before it, which its form leaves out, had to help.
const typedOk = (o) => formWorked(o) && !o.env

// Can `form` stand in for the failing `aForm`? Another form, and, outside test runs and builds, not a
// bare one: only a fuller spelling repairs a bare interpreter or package tool.
const repairs = (form, aForm, intent) => form !== aForm && (intent === 'run_tests' || intent === 'run_build' || !isBare(form))

/**
 * Fold one finished dispatch or session into `store`, in place. `calls` is grimoire's call list
 * (`{ name, input, result, ok, cwd, exitCode? }`). Options: `iid` and `resolved` (recorded in
 * `store.lastDigest`), `edited` (the edited files' basenames, read off the edit calls when absent),
 * `at` (a timestamp recorded in the digest; the facts age in folds, `store.now`, never in time).
 */
export function update(store, calls, { iid = '', resolved = null, edited = null, at = null } = {}) {
  let digest
  try { digest = observeCalls(calls) } catch {
    store.now++
    store.lastInjected = []
    return store
  }
  const now = store.now
  const obs = digest.obs
  const files = new Set(Array.isArray(edited) ? edited : digest.edited)
  const injected = new Set(store.lastInjected || [])
  const verdicts = {}
  const facts = store.facts
  const ofFamily = (fam) => Object.values(facts).filter((f) => f.family === fam)
  const byIntent = {}
  for (const o of obs) (byIntent[o.intent] ??= []).push(o)

  // ---- form repair: discover candidates, then fold every fact ----
  for (const intent of ['run_interpreter', 'run_tests', 'run_build', 'package_tool']) {
    const seq = byIntent[intent] ?? []
    // A test run that failed because its LABEL did not load says nothing about the way the runner was
    // called: those are arg repair's.
    let fails = seq.filter(formFailed)
    // An explicit path or activation that fails is a missing dependency, not a resolution problem:
    // only a bare form can be repaired by a fuller one.
    if (intent !== 'run_tests' && intent !== 'run_build') fails = fails.filter((o) => isBare(o.form))
    for (const a of fails) {
      if (!seq.some((o) => typedOk(o) && o.call > a.call && repairs(o.form, a.form, intent))) continue
      const fid = `form_repair:${intent}:${a.form}`
      if (!Object.hasOwn(facts, fid)) facts[fid] = newFact(fid, 'form_repair', false, { intent, a: a.form, bCounts: {}, errorCounts: {} })
      inc(facts[fid].params.errorCounts, a.outcome)
    }
    // A session is one piece of evidence per form: every form that worked as typed adds one, and a
    // known working form that failed as typed (and never worked) takes one back, so one messy session
    // cannot outvote several clean ones, and a form that stops working here stops being named.
    const ok = uniq(seq.filter(typedOk).map((o) => o.form))
    const failed = uniq(seq.filter((o) => formFailed(o) && !o.env).map((o) => o.form)).filter((f) => !ok.includes(f))
    for (const f of ofFamily('form_repair')) {
      if (f.params.intent !== intent) continue
      for (const form of ok) if (repairs(form, f.params.a, intent)) inc(f.params.bCounts, form)
      const bFails = (f.params.bFails ??= {})
      for (const form of failed) if (Object.hasOwn(f.params.bCounts, form)) inc(bFails, form)
    }
  }
  for (const f of ofFamily('form_repair')) {
    const { intent, a: aForm } = f.params
    const seq = byIntent[intent] ?? []
    const exercised = seq.length > 0
    const aFailed = seq.some((o) => o.form === aForm && formFailed(o))
    const bRan = seq.some((o) => Object.hasOwn(f.params.bCounts, o.form) && formWorked(o)) || seq.some((o) => formWorked(o) && !isBare(o.form))
    // Contradiction: the bare form ran the TEST RUNNER without an environment error. A bare
    // interpreter one-liner succeeding is no evidence (a pure-Python package imports from the working
    // tree under any interpreter).
    const aRunnerOk = (byIntent.run_tests ?? []).some((o) => o.form === aForm && formWorked(o))
    // a prevented failure still counts as fired: the fact was given and the working form ran
    const fired = aFailed || (injected.has(f.id) && bRan && !aFailed)
    const verdict = aFailed || (bRan && !aRunnerOk) ? 'confirm' : aRunnerOk ? 'contradict' : null
    fold(f, now, verdict, fired, exercised, files)
    verdicts[f.id] = [verdict, fired, exercised]
  }

  // ---- arg repair: labels the runner loads only in another shape ----
  const runs = (byIntent.run_tests ?? []).filter((o) => o.labels.length)
  runs.forEach((aObs, i) => {
    if (!aObs.labelErr) return
    for (const a of aObs.labels) {
      for (const bObs of runs.slice(i + 1)) {
        if (bObs.form !== aObs.form || !bObs.loaded) continue
        const b = bObs.labels.find((x) => labelRule(a, x))
        if (b === undefined) continue
        const [kind, param] = labelRule(a, b)
        const fid = `arg_repair:${aObs.form}:${kind}:${param}`
        if (!Object.hasOwn(facts, fid)) facts[fid] = newFact(fid, 'arg_repair', false, { form: aObs.form, kind, param, examples: {} })
        inc(facts[fid].params.examples, `${a} ${b}`)
        break
      }
    }
  })
  for (const f of ofFamily('arg_repair')) {
    const mine = runs.filter((o) => o.form === f.params.form)
    const bad = f.params.kind === 'sep' ? (lab) => lab.includes('::') : (lab) => lab.startsWith(f.params.param)
    const badFailed = mine.some((o) => o.labelErr && o.labels.some(bad))
    const badLoaded = mine.some((o) => o.loaded && o.labels.some(bad))
    const goodLoaded = mine.some((o) => o.loaded && o.labels.some((x) => !bad(x)))
    const exercised = mine.length > 0
    const fired = badFailed || (injected.has(f.id) && goodLoaded && !badFailed)
    const verdict = badLoaded ? 'contradict' : badFailed || goodLoaded ? 'confirm' : null
    fold(f, now, verdict, fired, exercised, files)
    verdicts[f.id] = [verdict, fired, exercised]
  }

  // ---- env value: a variable the code asks for, and the value that satisfied it ----
  const env = digest.env
  env.forEach((c, i) => {
    for (const v of c.need) {
      const later = env.slice(i + 1).filter((d) => Object.hasOwn(d.sets, v))
      const good = later.filter((d) => d.ok && !d.need.includes(v)).map((d) => d.sets[v])
      if (!good.length) continue
      const fid = `env_value:${v}`
      if (!Object.hasOwn(facts, fid)) facts[fid] = newFact(fid, 'env_value', false, { var: v, good: {}, bad: {} })
      const f = facts[fid]
      inc(f.params.good, good[0])
      for (const d of later) if (!d.ok && d.sets[v] !== good[0]) inc(f.params.bad, d.sets[v])
    }
  })
  for (const f of ofFamily('env_value')) {
    const v = f.params.var
    const good = best(f.params.good)
    const asked = env.some((c) => c.need.includes(v))
    const goodOk = env.some((c) => Object.hasOwn(c.sets, v) && c.sets[v] === good && c.ok)
    const goodFailed = env.some((c) => Object.hasOwn(c.sets, v) && c.sets[v] === good && c.need.includes(v))
    const exercised = asked || env.some((c) => Object.hasOwn(c.sets, v))
    const fired = asked || (injected.has(f.id) && goodOk)
    // Only the value working confirms the fact: code asking for the variable again shows the waste
    // recurs (it fires), not that the learned value is right.
    const verdict = goodFailed ? 'contradict' : goodOk ? 'confirm' : null
    fold(f, now, verdict, fired, exercised, files)
    verdicts[f.id] = [verdict, fired, exercised]
  }

  // ---- boundary: hosts refused ----
  const fetches = byIntent.fetch_remote ?? []
  const failedHosts = {}
  for (const o of fetches) if (NETWORK_ERRORS.has(o.outcome)) for (const h of o.hosts) inc(failedHosts, h)
  const okHosts = new Set(fetches.filter((o) => o.outcome === 'ran').flatMap((o) => o.hosts))
  {
    const fid = 'boundary:fetch_remote'
    if (!Object.hasOwn(facts, fid) && Object.keys(failedHosts).length) facts[fid] = newFact(fid, 'boundary', true, { hosts: {} })
    const f = facts[fid]
    if (f) {
      for (const [h, n] of Object.entries(failedHosts)) inc(f.params.hosts, h, n)
      const known = new Set(Object.keys(f.params.hosts))
      const exercised = fetches.some((o) => o.hosts.length)
      const fired = Object.keys(failedHosts).length > 0
      const verdict = [...okHosts].some((h) => known.has(h)) ? 'contradict' : fired ? 'confirm' : null
      fold(f, now, verdict, fired, exercised, files)
      verdicts[fid] = [verdict, fired, exercised]
    }
  }

  // ---- empty probe: refs beyond the checkout ----
  const probes = (byIntent.probe_vcs_refs ?? []).filter((o) => o.outcome === 'hit' || o.outcome === 'empty')
  {
    const fid = 'empty_probe:vcs_refs'
    if (!Object.hasOwn(facts, fid) && probes.length) facts[fid] = newFact(fid, 'empty_probe', true, { kinds: {} })
    const f = facts[fid]
    if (f) {
      for (const o of probes) inc(f.params.kinds, o.probe)
      const exercised = probes.length > 0
      const fired = exercised
      const verdict = probes.some((o) => o.outcome === 'hit') ? 'contradict' : probes.length ? 'confirm' : null
      fold(f, now, verdict, fired, exercised, files)
      verdicts[fid] = [verdict, fired, exercised]
    }
  }

  store.lastDigest = { iid, resolved, at, injected: [...injected].sort(), verdicts, nCalls: digest.nCalls }
  store.lastInjected = []
  store.now++
  return store
}
