// grimoire-live · a live view of grimoire beside the chat, drawn from one snapshot that
// grimoire's own `scripts/live.mjs` prints (the mod reads and decides nothing else):
//
//   - a pane, "grimoire run": the build loop's run as it goes (tasks, who works on what, the
//     latest decisions, the cost against its cap), opened when a run starts or by /grimoire-run;
//   - the band above the prompt: the manager briefing's line while it asks for attention;
//   - the status line: the running run, its progress and its cost;
//   - a card on graph_diff's row: its risk and what it reaches, at a glance;
//   - a toast when a run halts or ends, nears its cost cap, goes quiet, or the stuck watch flags
//     an agent.
//
// Where it finds the script: grimoire's SessionStart hook writes the plugin's root into
// `<project>/.grimoire/live/plugin-root`. Without it (grimoire not installed, never run here)
// the mod draws nothing but the pane's one line saying why.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LiveSnapshot } from '../types'
import { ago, bandLine, costShare, costText, diffSummary, isDiffTool, isLive, statusLine, transitions } from './view'

const PANE = 'grimoire-run'
const EVERY_MS = 5000
const snapshot = atom({ plugin: 'grimoire-live', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })
const problem = atom({ plugin: 'grimoire-live', key: 'problem' } as const, null)
const isBandHidden = atom({ plugin: 'grimoire-live', key: 'isBandHidden' } as const, false)

// what the last poll printed, and the snapshot it was (a reload starts them over)
let lastText = ''
let last: LiveSnapshot | null = null
// the poll in flight: a second caller waits for it rather than starting another
let inflight: Promise<void> | null = null
let lastStatus: string | undefined
let lastProblem: string | null | undefined

// a write redraws the pane: only when the reason changes
async function setProblem($: EngineInterface, why: string | null) {
  if (why === lastProblem) return
  lastProblem = why
  await update($, problem, () => why)
}

function poll($: EngineInterface): Promise<void> {
  if (!inflight) inflight = pollOnce($).finally(() => { inflight = null })
  return inflight
}

async function pollOnce($: EngineInterface) {
  try {
    const cwd: string = await $.session.cwd()
    let root: string | null = null
    try {
      root = (String(await $.fs.read(`${cwd}/.grimoire/live/plugin-root`)).split('\n')[0] ?? '').trim() || null
    } catch {
      root = null
    }
    if (!root) {
      await setProblem($, 'grimoire has not run in this project yet (its session hook writes .grimoire/live/plugin-root)')
      return
    }
    const ran = await $.process.run(['node', `${root}/scripts/live.mjs`, '--root', cwd], { timeoutMs: 15000 })
    if (ran.exitCode !== 0) {
      await setProblem($, `scripts/live.mjs exited ${ran.exitCode}`)
      return
    }
    const text = String(ran.stdout).trim()
    if (text === lastText) return
    const snap = JSON.parse(text) as LiveSnapshot
    if (!snap || snap.version !== 1) {
      await setProblem($, 'scripts/live.mjs printed a snapshot this mod does not read (update grimoire-live)')
      return
    }
    const before = last
    lastText = text
    last = snap
    await update($, snapshot, () => snap)
    await setProblem($, null)
    const status = statusLine(snap)
    if (status !== lastStatus) { $.ui.status(status); lastStatus = status }
    for (const line of transitions(before, snap)) $.ui.toast(line)
    // a run that starts opens its pane (unasked, the surface places it only where it is a sidebar)
    if (isLive(snap.run) && !(before && isLive(before.run) && before.run.id === snap.run.id)) {
      void $.ui.open({ id: PANE, title: `grimoire run ${snap.run.id}` })
    }
  } catch (err) {
    await setProblem($, `the live snapshot could not be read: ${String((err as Error)?.message ?? err).slice(0, 160)}`)
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'grimoire-run', description: 'Show the grimoire build loop\'s run in a pane, live' })
    await $.command.register({ name: 'grimoire-band', description: 'Show or hide the grimoire briefing above the prompt' })
    $.clock.every(EVERY_MS, () => poll($))
    void poll($)
    return next(e)
  })

  on('command.run', { command: 'grimoire-run' }, async ($) => {
    await poll($)
    const snap = await read($, snapshot)
    await $.ui.open({ id: PANE, title: snap?.run ? `grimoire run ${snap.run.id}` : 'grimoire run' })
    return { text: snap?.run ? `grimoire run ${snap.run.id}: ${snap.run.status}.` : 'No grimoire run in the last 6 hours.' }
  })

  on('command.run', { command: 'grimoire-band' }, async ($) => {
    const hidden = await update($, isBandHidden, (x) => !x)
    return { text: hidden ? 'The grimoire briefing band is hidden.' : 'The grimoire briefing band is shown.' }
  })

  // ── the pane ──
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Progress } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const why = await read($, problem)
    const run = snap?.run ?? null
    const now = Date.parse(snap?.at ?? '') || 0
    if (!run) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{why ?? 'No grimoire run in the last 6 hours.'}</Text>
          {snap?.briefing ? <Text wrap="truncate">{snap.briefing.line}</Text> : null}
        </Box>
      )
    }
    const t = run.tasks
    const share = costShare(run)
    const head = `${run.status}${run.haltReason ? ` (${run.haltReason})` : ''} · started ${ago(run.startedAt, now)} ago · last event ${ago(run.updatedAt, now)} ago`
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text wrap="truncate">{`${run.id} · ${t.done}/${t.total} · ${run.status}`}</Text>
          <Progress label="tasks done" value={t.done} max={Math.max(1, t.total)} />
        </Box>
      )
    }
    const room = Math.max(4, (e.viewport?.rows ?? 30) - 12)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold wrap="truncate">{`Run ${run.id}`}</Text>
          <Text dimColor wrap="truncate">{head}</Text>
          {run.isStale ? <Text color="warning">No event for 15 minutes or more.</Text> : null}
          {why ? <Text color="warning" wrap="truncate">{why}</Text> : null}
        </Box>
        <Box flexDirection="column">
          <Progress label="tasks done" value={t.done} max={Math.max(1, t.total)} valueText={`${t.done} of ${t.total}`} />
          <Text dimColor wrap="truncate">{`${t.active} active · ${t.queued} queued · ${t.blocked} blocked · ${t.failed} failed`}</Text>
          {share === null
            ? <Text dimColor wrap="truncate">{costText(run)}</Text>
            : <Progress label="cost against its cap" value={Math.min(1, share)} valueText={costText(run)} color={share >= 0.8 ? 'warning' : undefined} />}
        </Box>
        <Box flexDirection="column">
          <Text bold>Working now</Text>
          {run.active.length === 0 ? <Text dimColor>Nothing in flight.</Text> : null}
          {run.active.slice(0, 8).map((a) => (
            <Box flexDirection="column">
              <Text wrap="truncate">{`${a.task} · ${a.step ?? '?'} · ${a.agent ?? '?'} on ${a.model ?? '?'}${a.round ? ` · round ${a.round}` : ''} · ${ago(a.since, now)}`}</Text>
              {a.title ? <Text dimColor wrap="truncate">{`  ${a.title}`}</Text> : null}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text bold>Latest decisions</Text>
          {run.recent.length === 0 ? <Text dimColor>None yet.</Text> : null}
          {run.recent.slice(0, room).map((r) => (
            <Text wrap="truncate">{`${ago(r.at, now).padStart(3)}  ${r.text}`}</Text>
          ))}
        </Box>
        {snap?.watch && snap.watch.flags.length ? (
          <Box flexDirection="column">
            <Text bold color="warning">{`Stuck watch (${snap.watch.mode})`}</Text>
            {snap.watch.flags.map((f) => <Text wrap="truncate">{`${f.agent}: ${f.reason}`}</Text>)}
          </Box>
        ) : null}
      </Box>
    )
  })

  // ── the band above the prompt ──
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    const line = bandLine(snap)
    if (!line || e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor wrap="truncate">{`${line} `}</Text>
        {isLive(snap?.run ?? null) ? <Button key="run" label="Run" onPress={() => $.ui.open({ id: PANE, title: `grimoire run ${snap!.run!.id}` })} /> : null}
        <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  // ── graph_diff's row: its risk, and what it reaches ──
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (!isDiffTool(String(p.tool)) || p.isRunning || p.isErrored || p.isExpanded) return next(e)
    const s = diffSummary(p.output)
    if (!s) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const row = await next(e)
    const color = s.risk === 'high' ? 'error' : s.risk === 'medium' ? 'warning' : 'success'
    const counts = [
      s.changed !== null ? `${s.changed} file(s) changed` : null,
      s.reach !== null ? `${s.reach} file(s) reach it` : null,
      s.tests !== null ? `${s.tests} test file(s) to run` : null,
    ].filter(Boolean).join(' · ')
    // a card on surfaces that draw one; a plain line under the row on the terminal
    const frame = e.surface === 'terminal' ? {} : { borderStyle: 'round', borderColor: color, paddingX: 1 }
    return (
      <Box flexDirection="column" {...frame}>
        {row}
        <Box flexDirection="column">
          <Text color={color} bold>{`Risk ${s.risk}`}</Text>
          {counts ? <Text dimColor wrap="truncate">{counts}</Text> : null}
          {s.reasons ? <Text dimColor maxLines={2}>{s.reasons}</Text> : null}
        </Box>
      </Box>
    )
  })
}
