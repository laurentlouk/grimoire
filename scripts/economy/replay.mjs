#!/usr/bin/env node
// grimoire · economy · replay: the stuck watch run offline over recorded loop runs, to see what it
// would have flagged before it is trusted to act (token economy slice 3).
//
//   node scripts/economy/replay.mjs [--dir .grimoire/runs] [--claude-dir <dir>] [--json]
//     → per role (a repo and an agent type): the dispatches, those the judge gate opened on, the
//       stuck ones (the strict rule), the would-redirect and would-block verdicts of the free rules
//       past the role's envelope, the envelope at the end, and what the flagged dispatches cost.
//
// Each dispatch's calls go through the hook's own fold (loopguard/turn.mjs), from its Claude Code
// transcript (a call's is_error is its failure). The envelope is learned in order, from the role's
// earlier dispatches that ended green, so a dispatch never gates itself. No model is called; the
// judge's verdicts (slice 4) are not replayed.
//
// Adapted from microsoft/TokenEconomizer's offline replay of its guard over saved trajectories
// (tokeneconomizer/loopguard, commit 1deb887, Apache-2.0).
import { join, resolve } from 'node:path'
import { readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readAgent } from './transcript.mjs'
import { price } from './pricing.mjs'
import { findRunWorkflows, labelContext, attributeIn, indexWorkflows, rootsOf } from './runs.mjs'
import { newTurn, foldCall, resolved, freeVerdict, decide } from './loopguard/turn.mjs'
import { gateForJudge, isStuck, DEFAULT_THRESHOLDS } from './loopguard/rules.mjs'
import { envelopeOf } from './loopguard/envelope.mjs'

const agentFiles = (p) => { try { return readdirSync(p).filter((f) => /^agent-.*\.jsonl$/.test(f)).sort() } catch { return [] } }

/** The watch over `runs` ({runId, events}, oldest first): per role, what it would have flagged. */
export function replay(runs, opts = {}) {
  const thr = opts.thr || DEFAULT_THRESHOLDS
  const roles = {}, samples = {}
  let read = 0
  for (const run of runs) {
    const workflows = findRunWorkflows(run.runId, opts).sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
    if (!workflows.length) continue
    read++
    const ctx = labelContext(run.events)
    for (const wf of workflows) {
      for (const f of agentFiles(wf.agentsDir)) {
        const a = readAgent(join(wf.agentsDir, f))
        if (!a.meta || !a.meta.agentType) continue
        const role = `${attributeIn(a.meta.label, ctx).repo ?? '-'}/${a.meta.agentType}`
        const r = (roles[role] ||= { dispatches: 0, gated: 0, stuck: 0, wouldRedirect: 0, wouldBlock: 0, envelope: null, flaggedCost: 0 })
        const envelope = envelopeOf(samples[role] || [], thr)
        const t = newTurn({ agentType: a.meta.agentType })
        let gated = false, stuck = false
        for (const c of a.calls) {
          foldCall(t, { name: c.name, args: c.input, result: c.result, exitCode: c.ok === false ? 1 : null })
          gated ||= gateForJudge(t.st, thr)
          stuck ||= isStuck(t.st, thr)
          if (t.blocked) continue
          const v = freeVerdict(t, envelope, thr)
          if (v && decide(t, v) === 'would-redirect') r.wouldRedirect++
          else if (v) r.wouldBlock++
        }
        r.dispatches++
        if (gated) r.gated++
        if (stuck) r.stuck++
        if (gated || stuck) r.flaggedCost += price(a.usage, a.model ?? a.meta.model).effective
        if (resolved(t)) (samples[role] ||= []).push(t.calls)
        r.envelope = envelopeOf(samples[role] || [], thr)
      }
    }
  }
  const out = {}
  for (const k of Object.keys(roles).sort()) out[k] = { ...roles[k], flaggedCost: Math.round(roles[k].flaggedCost * 100) / 100 }
  return { runs: read, roles: out }
}

/** One line per role. */
export function replayText(r) {
  const lines = [`stuck watch, replayed over ${r.runs} run${r.runs === 1 ? '' : 's'} (free rules only; no judge):`]
  for (const [role, x] of Object.entries(r.roles)) {
    lines.push(`  ${role}: ${x.dispatches} dispatch${x.dispatches === 1 ? '' : 'es'} · gated ${x.gated} · stuck ${x.stuck} · would redirect ${x.wouldRedirect} · would block ${x.wouldBlock} · envelope ${x.envelope === null ? 'none yet' : `${x.envelope.toFixed(1)} calls`} · flagged cost ${Math.round(x.flaggedCost).toLocaleString('en-US')}`)
  }
  return lines.join('\n')
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) {
  const argv = process.argv.slice(2)
  const arg = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const { loadRuns } = await import('../render-logs.mjs')
  const { loadConfig, mainCheckout } = await import('../project-config.mjs')
  const root = mainCheckout(process.cwd()) ?? process.cwd()
  const cfg = loadConfig(root).config || {}
  const dir = resolve(root, arg('dir') ?? (typeof cfg.telemetry?.dir === 'string' && cfg.telemetry.dir ? cfg.telemetry.dir : '.grimoire/runs'))
  const runs = loadRuns(dir).sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? ''))) // oldest first: the envelope learns in order
  const claudeDir = arg('claude-dir') ?? undefined
  const r = replay(runs, { claudeDir, index: indexWorkflows({ claudeDir, roots: rootsOf(root) }) })
  console.log(argv.includes('--json') ? JSON.stringify(r, null, 2) : replayText(r))
}
