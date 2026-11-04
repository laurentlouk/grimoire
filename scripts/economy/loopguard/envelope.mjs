// grimoire · economy · loopguard · envelope: how long a dispatch of one role (a repo and an agent type)
// that ended green usually runs, in tool calls: margin × the pct-th percentile of those dispatches,
// once there are min_samples of them, else null (the guard is then inert for that role). A dispatch's
// own outcome only ever gates later dispatches.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/loopguard/envelope.py (commit 1deb887,
// Apache-2.0): the linear percentile and the envelope. The learned thresholds are not ported: grimoire
// keeps the defaults until replays show they need tuning.
import { DEFAULT_THRESHOLDS } from './rules.mjs'

export const ENVELOPE_HISTORY = 500 // the most recent ended-green dispatches kept per role

/** Linear-interpolated p-th percentile (0–100) of xs; null for none. */
export function percentile(xs, p) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 1) return s[0]
  const i = (p / 100) * (s.length - 1)
  const lo = Math.floor(i)
  return lo + 1 >= s.length ? s[s.length - 1] : s[lo] + (i - lo) * (s[lo + 1] - s[lo])
}

/** The envelope of a role from its ended-green dispatch lengths, or null before min_samples. */
export function envelopeOf(samples, thr = DEFAULT_THRESHOLDS) {
  const xs = (Array.isArray(samples) ? samples : []).filter((n) => Number.isFinite(n) && n > 0)
  return xs.length < thr.envelope_min_samples ? null : percentile(xs, thr.envelope_pct) * thr.envelope_margin
}

/** `store` (envelope.json's content) with one more ended-green length for `role`, the history capped. */
export function withSample(store, role, calls) {
  const out = store && typeof store === 'object' && !Array.isArray(store) ? { ...store } : {}
  const prev = Array.isArray(out[role]?.resolved) ? out[role].resolved : []
  out[role] = { resolved: [...prev, calls].slice(-ENVELOPE_HISTORY) }
  return out
}
