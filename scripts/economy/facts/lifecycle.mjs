// grimoire · economy · facts · lifecycle: the states every learned fact goes through. A fact is a
// CANDIDATE until it is confirmed on K_PROMOTE dispatches or sessions (any of them for a fact about the
// environment, which does not change with the files a session edits: `drift: false`; ones that edited
// different files otherwise). It is then ACTIVE until a recency-weighted score, with contradictions
// weighted LAMBDA times a confirmation, falls below the floor, or at once, for a high-stakes fact, on
// one clean contradiction. An ACTIVE fact is injected only while it clears the FIRING GATE: the waste
// it prevents occurred (or, once injected, kept being prevented) on at least FIRE_GATE of the
// sessions that exercised it, over at least FIRE_MIN_N of them.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/microskills/lifecycle.py (commit 1deb887,
// Apache-2.0): the knobs are its validated replay constants. The `Lifecycle` class is a plain JSON
// object here (the store is written as it is), with its key left to the fact that holds it; the
// experiments' Python-only `edited_pyfiles` is left out.
import { basename } from '../loopguard/state.mjs'

export const K_PROMOTE = 3 // confirmations (drifted, where drift applies) to promote → ACTIVE
export const GAMMA = 0.8 // recency decay per fold ago
export const LAMBDA = 5.0 // contradiction weight (asymmetry: fail toward retirement)
export const SCORE_FLOOR = 0.0 // retire ACTIVE when the recency score < floor
export const HARD_KILL = true // a high-stakes fact: a single clean contradiction retires it now
export const FIRE_GATE = 0.40 // inject only if the firing rate here is ≥ 40 %
export const FIRE_MIN_N = 4 // ...measured over at least this many exercised folds

const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'create', 'str_replace_editor'])

/** Every file an edit tool wrote, by basename, whatever its language. `calls` are `[tool, input]`
 * pairs with the tool name lowercased. */
export function editedFiles(calls) {
  const fs = new Set()
  for (const [tool, args] of calls) {
    if (EDIT_TOOLS.has(tool)) {
      const p = args.file_path || args.path || ''
      if (p) fs.add(basename(p))
    } else if (tool === 'apply_patch') for (const p of Array.isArray(args.paths) ? args.paths : []) fs.add(basename(p))
  }
  return fs
}

/** A fresh lifecycle. `drift`: promotion needs confirmations on sessions that edited different files. */
export const newLife = (high, drift = true) => ({
  high: !!high, drift: !!drift,
  state: 'CANDIDATE', // CANDIDATE | ACTIVE | RETIRED
  confirms: [], // [[fold, [edited files]]]
  contradicts: [], // [fold]
  fireNum: 0, // folds where the waste occurred (fired)
  fireDen: 0, // folds where the fact was exercised
  promotedAt: null,
  retiredAt: null,
})

function driftedConfirms(life) {
  if (!life.drift) return life.confirms.length
  const kept = []
  for (const [, files] of life.confirms) {
    const fs = new Set(files)
    if (!fs.size || kept.every((k) => ![...fs].some((f) => k.has(f)))) kept.push(fs)
  }
  return kept.length
}

/** Recency-weighted confirmations less LAMBDA × recency-weighted contradictions, at fold `now`. */
export function score(life, now) {
  let s = 0
  for (const [i] of life.confirms) s += GAMMA ** (now - i)
  for (const i of life.contradicts) s -= LAMBDA * GAMMA ** (now - i)
  return s
}

export const firingRate = (life) => (life.fireDen ? life.fireNum / life.fireDen : 0)

/** ACTIVE and clears the firing gate: it goes into the rendered block. */
export const injectable = (life) => life.state === 'ACTIVE' && life.fireDen >= FIRE_MIN_N && firingRate(life) >= FIRE_GATE

/** Fold one dispatch or session's verdict ('confirm' | 'contradict' | null) into `life`, in place. */
export function updateLife(life, now, verdict, fired, exercised, files) {
  if (exercised) {
    life.fireDen++
    if (fired) life.fireNum++
  }
  if (verdict === 'confirm') life.confirms.push([now, life.drift ? [...files].sort() : []]) // the files are read only under drift
  else if (verdict === 'contradict') life.contradicts.push(now)
  if (life.state === 'CANDIDATE') {
    if (driftedConfirms(life) >= K_PROMOTE) { life.state = 'ACTIVE'; life.promotedAt = now }
  } else if (life.state === 'ACTIVE') {
    const hard = life.high && verdict === 'contradict' && HARD_KILL
    if (hard || score(life, now) < SCORE_FLOOR) { life.state = 'RETIRED'; life.retiredAt = now }
  }
}
