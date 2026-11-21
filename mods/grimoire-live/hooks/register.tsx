// grimoire-live · a live view of grimoire beside the chat, drawn from one snapshot that
// grimoire's own `scripts/live.mjs` prints (the mod reads and decides nothing else):
//
//   - a pane, "grimoire run": the build loop's run as it goes (tasks, who works on what, the
//     latest decisions, the cost against its cap), opened by /grimoire-run (a toast says when a
//     run starts; the mod never opens a pane unasked);
//   - the band above the prompt: the manager briefing's line while it asks for attention;
//   - the status line: the running run, its progress and its cost;
//   - a card on graph_diff's row: its risk and what it reaches, at a glance;
//   - a toast when a run halts or ends, nears its cost cap, goes quiet, or the stuck watch flags
//     an agent.
//
// Where it finds the script: grimoire's SessionStart hook writes the plugin's root into
// `<project>/.grimoire/live/plugin-root` (in a linked worktree, the main checkout's is read too).
// It is followed only when it names an installed grimoire outside the project. Without it
// (grimoire not installed, never run here) the mod draws nothing but the pane's one line saying why.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LiveSnapshot } from '../types'
import { ago, bandLine, costShare, costText, diffSummary, isDiffTool, isLive, statusLine, transitions } from './view'

const PANE = 'grimoire-run'
const EVERY_MS = 5000
const snapshot = atom({ plugin: 'grimoire-live', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })
const problem = atom({ plugin: 'grimoire-live', key: 'problem' } as const, null)
const isBandHidden = atom({ plugin: 'grimoire-live', key: 'isBandHidden' } as const, false)

// what the last poll read, its time left out (a reload starts these over; the snapshot itself is
// kept in $.state, so a reload compares with what was drawn)
let lastKey = ''
// the poll in flight: a second caller waits for it rather than starting another
let inflight: Promise<void> | null = null
let lastStatus: string | undefined
let lastProblem: string | null | undefined
let tick: { cancel: () => void } | null = null
// per working directory: the main checkout's root when it is a linked git worktree, else null
const mainOf = new Map<string, string | null>()

// a write redraws the pane: only when the reason changes
async function setProblem($: EngineInterface, why: string | null) {
  if (why === lastProblem) return
  lastProblem = why
  await update($, problem, () => why)
}

function setStatus($: EngineInterface, text: string | undefined) {
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

// The snapshot stopped coming (no pointer, the script failed): nothing stale stays on screen.
async function lost($: EngineInterface, why: string) {
  setStatus($, undefined)
  if (lastKey) { lastKey = ''; await update($, snapshot, () => null) }
  await setProblem($, why)
}

const trimSlash = (p: string) => p.replace(/\/+$/, '')
const isUnder = (p: string, dir: string) => { const d = trimSlash(dir); return p === d || p.startsWith(`${d}/`) }

// A linked worktree keeps grimoire's state in its main checkout: git says where that is.
async function mainCheckout($: EngineInterface, cwd: string): Promise<string | null> {
  if (mainOf.has(cwd)) return mainOf.get(cwd) ?? null
  let main: string | null = null
  try {
    const r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, timeoutMs: 5000 })
    const dir = r.exitCode === 0 ? String(r.stdout).trim() : ''
    if (dir.endsWith('/.git')) { const m = dir.slice(0, -'/.git'.length); if (m && m !== trimSlash(cwd)) main = m }
  } catch {}
  mainOf.set(cwd, main)
  return main
}

// The pointer grimoire's SessionStart hook writes, trusted only when it names an installed grimoire:
// an absolute path outside the project (a repository could ship a pointer to a script of its own),
// holding a plugin.json named grimoire and scripts/live.mjs.
async function grimoireRoot($: EngineInterface, cwd: string): Promise<{ root: string } | { why: string }> {
  const main = await mainCheckout($, cwd)
  let raw: string | null = null
  for (const dir of [cwd, main]) {
    if (!dir || raw) continue
    try { raw = (String(await $.fs.read(`${trimSlash(dir)}/.grimoire/live/plugin-root`)).split('\n')[0] ?? '').trim() || null } catch {}
  }
  if (!raw) return { why: 'grimoire has not run in this project yet (its session hook writes .grimoire/live/plugin-root)' }
  const root = trimSlash(raw)
  const ok = root.startsWith('/') && !/(^|\/)\.\.?(\/|$)/.test(root) && !isUnder(root, cwd) && !(main && isUnder(root, main))
  if (ok) {
    try {
      const manifest = JSON.parse(String(await $.fs.read(`${root}/.claude-plugin/plugin.json`)))
      await $.fs.stat(`${root}/scripts/live.mjs`)
      if (manifest?.name === 'grimoire') return { root }
    } catch {}
  }
  return { why: '.grimoire/live/plugin-root does not name an installed grimoire: not followed' }
}

function poll($: EngineInterface): Promise<void> {
  if (!inflight) inflight = pollOnce($).finally(() => { inflight = null })
  return inflight
}

async function pollOnce($: EngineInterface) {
  try {
    const cwd: string = await $.session.cwd()
    const found = await grimoireRoot($, cwd)
    if ('why' in found) return await lost($, found.why)
    const ran = await $.process.run(['node', `${found.root}/scripts/live.mjs`, '--root', cwd], { timeoutMs: 15000 })
    if (ran.exitCode !== 0) return await lost($, `scripts/live.mjs exited ${ran.exitCode}`)
    const snap = JSON.parse(String(ran.stdout).trim()) as LiveSnapshot
    if (!snap || snap.version !== 1) return await lost($, 'scripts/live.mjs printed a snapshot this mod does not read (update grimoire-live)')
    await setProblem($, null)
    // its time changes on every call: the rest decides whether anything is to be drawn again
    const key = JSON.stringify({ ...snap, at: null })
    if (key === lastKey) return
    lastKey = key
    // what was drawn before (kept through a reload); a session's first snapshot is the baseline,
    // never toasted
    const before = await read($, snapshot)
    await update($, snapshot, () => snap)
    setStatus($, statusLine(snap))
    if (before) for (const line of transitions(before, snap)) $.ui.toast(line)
  } catch (err) {
    // the module may be going (a reload, the session's end): what is left to say is said if it can be
    await lost($, `the live snapshot could not be read: ${String((err as Error)?.message ?? err).slice(0, 160)}`).catch(() => {})
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'grimoire-run', description: 'Show the grimoire build loop\'s run in a pane, live' })
    await $.command.register({ name: 'grimoire-band', description: 'Show or hide the grimoire briefing above the prompt' })
    tick?.cancel()
    tick = $.clock.every(EVERY_MS, () => { void poll($) })
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
