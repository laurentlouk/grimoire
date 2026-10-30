// grimoire · economy · pricing: what a transcript's usage costs, in effective tokens (fresh-input
// equivalents), the way Anthropic bills it: a cache read at a tenth of input, a cache write at
// 1.25× (5-minute TTL) or 2× (1-hour TTL), output at 5×. The ratios hold across Claude models, so
// one curve prices them all; a model that is not Claude is priced on it too and labelled
// `fallback`, never an error. Adapted from microsoft/TokenEconomizer (tokeneconomizer/pricing.py,
// commit 1deb887, Apache-2.0), which weights every cache write at 1.25.

export const WEIGHTS = Object.freeze({ input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2, output: 5 })

/** opus · sonnet · haiku · other (a model that is not Claude's) · unknown (none recorded). */
export function tierOf(model) {
  if (model == null || model === '') return 'unknown'
  const m = String(model).toLowerCase()
  for (const t of ['opus', 'sonnet', 'haiku']) if (m.includes(t)) return t
  return 'other'
}

/** {effective, pricedBy}: effective tokens of one usage record, and whether the model was known. */
export function price(usage, model) {
  const u = usage || {}
  const n = (k) => (Number.isFinite(u[k]) ? u[k] : 0)
  const effective = n('input') * WEIGHTS.input + n('cacheRead') * WEIGHTS.cacheRead + n('cacheWrite5m') * WEIGHTS.cacheWrite5m
    + n('cacheWrite1h') * WEIGHTS.cacheWrite1h + n('output') * WEIGHTS.output
  const t = tierOf(model)
  const claude = t === 'opus' || t === 'sonnet' || t === 'haiku' || /claude/i.test(String(model ?? ''))
  return { effective: Math.round(effective * 100) / 100, pricedBy: claude ? 'claude' : 'fallback' }
}
