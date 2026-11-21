// grimoire-live · what the drawings say, as plain functions of the snapshot (no `$`), so the
// tests read them without a surface.
import type { LiveRun, LiveSnapshot } from '../types'

export const RUNNING = new Set(['running', 'resuming', 'started'])

// 1234567 → "1.2M", 12345 → "12k"
export function short(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?'
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(Math.round(n))
}

// how long ago an ISO time was, from `now` (ms): "12s", "4m", "2h", "3d"
export function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// The cost fuse stops a run at either cap: its effective cost against maxCost, or its output tokens
// against maxOutput. The share shown is the nearer of the two, 0..1, or null with neither cap set.
function shares(run: LiveRun): { share: number; text: string }[] {
  const c = run.cost, out: { share: number; text: string }[] = []
  if (c.maxCost && c.effective !== null) out.push({ share: c.effective / c.maxCost, text: `${short(c.effective)} / ${short(c.maxCost)} tokens${c.isCovered ? '' : ' (partial)'}` })
  if (c.maxOutput && c.output !== null) out.push({ share: c.output / c.maxOutput, text: `${short(c.output)} / ${short(c.maxOutput)} output tokens` })
  return out.sort((a, b) => b.share - a.share)
}

export function costShare(run: LiveRun): number | null {
  return shares(run)[0]?.share ?? null
}

export function costText(run: LiveRun): string {
  const top = shares(run)[0]
  if (top) return top.text
  const c = run.cost
  if (c.effective !== null) return `${short(c.effective)} tokens${c.isCovered ? '' : ' (partial)'}`
  if (c.output !== null) return `${short(c.output)} output tokens`
  return 'cost unknown'
}

export const isLive = (run: LiveRun | null): run is LiveRun => !!run && RUNNING.has(run.status)

// The status line: the run while one runs, else nothing (the band holds the briefing).
export function statusLine(snap: LiveSnapshot | null): string | undefined {
  const run = snap?.run ?? null
  if (!isLive(run)) return undefined
  const t = run.tasks
  const share = costShare(run)
  const parts = [`grimoire ${run.id}`, `${t.done}/${t.total} tasks`]
  if (t.active) parts.push(`${t.active} active`)
  if (t.failed) parts.push(`${t.failed} failed`)
  parts.push(share === null ? costText(run) : `cost ${Math.round(share * 100)}%`)
  if (run.isStale) parts.push('no event for 15m+')
  const flags = snap?.watch?.flags.length ?? 0
  if (flags) parts.push(`${flags} stuck flag${flags > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

// The band above the prompt: the briefing when it asks for attention, or a running run's line.
export function bandLine(snap: LiveSnapshot | null): string | null {
  const b = snap?.briefing ?? null
  if (b && ((b.urgent ?? 0) > 0 || (b.ready ?? 0) > 0 || b.isStale || b.isPartial)) return b.line
  return null
}

// What changed between two snapshots that deserves a toast (one line each).
export function transitions(before: LiveSnapshot | null, after: LiveSnapshot | null): string[] {
  const out: string[] = []
  const a = before?.run ?? null, b = after?.run ?? null
  if (b && a && a.id === b.id && RUNNING.has(a.status) && !RUNNING.has(b.status)) {
    out.push(`grimoire run ${b.id} ${b.status}${b.haltReason ? `: ${b.haltReason}` : ''}`)
  }
  if (b && isLive(b)) {
    const was = a && a.id === b.id ? costShare(a) : null, now = costShare(b)
    if (now !== null && now >= 0.8 && (was === null || was < 0.8)) out.push(`grimoire run ${b.id}: ${Math.round(now * 100)}% of its cost cap spent`)
    if (b.isStale && !(a && a.id === b.id && a.isStale)) out.push(`grimoire run ${b.id}: no event for 15 minutes`)
  }
  const seen = new Set((before?.watch?.flags ?? []).map((f) => `${f.agent}|${f.at}`))
  for (const f of after?.watch?.flags ?? []) if (!seen.has(`${f.agent}|${f.at}`)) out.push(`grimoire stuck watch: ${f.agent} ${f.reason}`)
  return out.slice(0, 3)
}

// graph_diff's answer, read from its text: the risk and the counts beside it.
export type DiffSummary = { risk: 'high' | 'medium' | 'low'; reasons: string; reach: number | null; tests: number | null; changed: number | null }

export function textOf(output: unknown, depth = 0): string {
  if (depth > 4 || output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map((x) => textOf(x, depth + 1)).join('\n')
  if (typeof output === 'object') {
    const o = output as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if (o.content !== undefined) return textOf(o.content, depth + 1)
    if (o.result !== undefined) return textOf(o.result, depth + 1)
  }
  return ''
}

export function diffSummary(output: unknown): DiffSummary | null {
  const text = textOf(output)
  const m = /^Risk: (high|medium|low)\b:?\s*(.*)$/m.exec(text)
  if (!m) return null
  const num = (re: RegExp) => { const x = re.exec(text); return x ? Number(x[1]) : null }
  return {
    risk: m[1] as DiffSummary['risk'],
    reasons: (m[2] ?? '').slice(0, 160),
    reach: num(/^Impact \(depth \d+\): (\d+) file\(s\) reach/m),
    tests: num(/^Tests to run: (\d+) test file\(s\)/m),
    changed: num(/^Changes against .*?: (\d+) file\(s\)/m),
  }
}

export const isDiffTool = (tool: string) => tool === 'graph_diff' || /__graph_diff$/.test(tool)
