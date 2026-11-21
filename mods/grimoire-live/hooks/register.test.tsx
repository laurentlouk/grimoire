import { expect, test } from 'claude-code/testing'

import type { LiveSnapshot } from '../types'
import { BIG, CLOSED, CORRUPT, FAILING, HALTED, OLD, RUNNING } from './fixtures/snapshots'
import { bandLine, diffSummary, statusLine, transitions } from './view'

const NOW = '2026-11-21T12:00:00.000Z'
const RUN: LiveSnapshot = {
  version: 1,
  at: NOW,
  root: '/proj',
  run: {
    id: 'r7',
    status: 'running',
    haltReason: null,
    startedAt: '2026-11-21T11:00:00.000Z',
    updatedAt: '2026-11-21T11:59:30.000Z',
    isStale: false,
    tasks: { total: 12, done: 5, active: 2, failed: 0, blocked: 1, queued: 4 },
    active: [{ task: 'T6', title: 'Add the export button', step: 'review', agent: 'reviewer', model: 'sonnet', round: 2, since: '2026-11-21T11:56:00.000Z' }],
    recent: [{ at: '2026-11-21T11:59:30.000Z', kind: 'verdict', task: 'T5', text: 'T5 review: pass (sonnet)' }],
    cost: { effective: 4_200_000, maxCost: 5_000_000, output: 90_000, maxOutput: null, isCovered: true },
  },
  briefing: { line: 'grimoire: 2 urgent · 3 ready for AI · briefing 1h old', urgent: 2, ready: 3, isStale: false, isPartial: false, page: null },
  watch: { mode: 'shadow', flags: [] },
  errors: 0,
}

const PANE = {
  plugin: 'grimoire-live',
  component: 'Pane',
  requestId: 'grimoire-run',
  props: { title: 'grimoire run', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const BAND = { plugin: 'grimoire-live', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as any

// the engine beneath the mod: a project with grimoire's pointer, a live.mjs printing `snap`
function world(on: any, snap: LiveSnapshot | null, seen: { status: (string | undefined)[]; toasts: string[]; opened: string[] }) {
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.read', (_: unknown, e: any) => (e.path === '/proj/.grimoire/live/plugin-root' && snap ? { value: '/opt/grimoire\n' } : { deny: 'ENOENT' }))
  on('process.run', (_: unknown, e: any) => ({ value: { exitCode: 0, stdout: JSON.stringify(snap), stderr: '', argv: e.argv } }))
  on('ui.status', (_: unknown, e: any) => { seen.status.push(e.text); return { value: undefined } })
  on('ui.toast', (_: unknown, e: any) => { seen.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_: unknown, e: any) => { seen.opened.push(e.id); return { value: { isPlaced: true } } })
}

test('a running run: the pane, the status line and the band, on every surface', async ($, on) => {
  const seen = { status: [] as (string | undefined)[], toasts: [] as string[], opened: [] as string[] }
  world(on, RUN, seen)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'grimoire-run', args: '' } as any)

  expect(seen.status.at(-1)).toBe('grimoire r7 · 5/12 tasks · 2 active · cost 84%')
  expect(seen.opened).toContain('grimoire-run')
  expect(seen.toasts.some((t) => /84% of its cost cap/.test(t))).toBe(true)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: /^Run r7$/ }))?.text).toBe('Run r7')
    expect((await pane.find({ type: 'Text', text: /T6 · review · reviewer on sonnet · round 2 · 4m/ }))).toBeTruthy()
    expect((await pane.find({ type: 'Text', text: /T5 review: pass/ }))).toBeTruthy()
    await pane.unmount()
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /2 urgent/ }))).toBeTruthy()
    await band.unmount()
  }
})

test('no grimoire in the project: the pane says why, the band and status stay empty', async ($, on) => {
  const seen = { status: [] as (string | undefined)[], toasts: [] as string[], opened: [] as string[] }
  world(on, null, seen)
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'grimoire-run', args: '' } as any)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /has not run in this project/ }))).toBeTruthy()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await band.unmount()
  expect(seen.status.filter(Boolean).length).toBe(0)
})

test('graph_diff: the risk under its row', async ($, on) => {
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>row</Text> })
  const output = { content: [{ type: 'text', text: 'Changes against main (the default) at abc: 2 file(s) (1 code, 1 other)\nImpact (depth 2): 11 file(s) reach the changed definitions, 11 of them outside this diff\nTests to run: 5 test file(s) reach the changed definitions\nRisk: high: removed column t.c is still named outside the lines this diff changed (176 place(s))' }] }
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'grimoire-live', component: 'ToolUse', requestId: 'tu1', surface, props: { tool_use_id: 'tu1', tool: 'mcp__plugin_grimoire_graph__graph_diff', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output } } as any)
    expect((await ui.find({ type: 'Text', text: /^Risk high$/ }))?.text).toBe('Risk high')
    expect((await ui.find({ type: 'Text', text: /2 file\(s\) changed · 11 file\(s\) reach it · 5 test file\(s\) to run/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^row$/ }))).toBeTruthy()
    await ui.unmount()
  }
})

test('the plain functions: status, band, toasts, the diff summary', async () => {
  expect(statusLine({ ...RUN, run: { ...RUN.run!, status: 'done' } })).toBe(undefined)
  expect(bandLine({ ...RUN, briefing: { ...RUN.briefing!, urgent: 0, ready: 0 } })).toBe(null)
  const halted = { ...RUN, run: { ...RUN.run!, status: 'halted', haltReason: 'budget_exhausted' } }
  expect(transitions(RUN, halted)).toEqual(['grimoire run r7 halted: budget_exhausted'])
  const flagged = { ...RUN, watch: { mode: 'on', flags: [{ agent: 'api-engineer', reason: 'same edit 4 times', at: NOW }] } }
  expect(transitions(RUN, flagged)).toEqual(['grimoire stuck watch: api-engineer same edit 4 times'])
  expect(diffSummary('nothing here')).toBe(null)
  expect(diffSummary('Risk: low')?.risk).toBe('low')
})

// what scripts/live.mjs really prints, on its own fixtures: each draws on every surface
const CASES = [
  ['running', RUNNING, /^Run R1$/], ['halted by the cost fuse', HALTED, /halted \(budget_exhausted\)/], ['closed', CLOSED, /^closed/],
  ['a corrupt chunk', CORRUPT, /^Run R7$/], ['quiet for 15 minutes', BIG, /No event for 15 minutes/],
  ['only old runs', OLD, /No grimoire run in the last 6 hours/], ['a part that threw', FAILING, /No grimoire run in the last 6 hours/],
] as const
for (const [name, snap, want] of CASES) {
  test(`live.mjs's snapshot, ${name}: the pane draws it`, async ($, on) => {
    const seen = { status: [] as (string | undefined)[], toasts: [] as string[], opened: [] as string[] }
    world(on, snap, seen)
    await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'grimoire-run', args: '' } as any)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ type: 'Text', text: want })).toBeTruthy()
      await pane.unmount()
    }
  })
}

test('live.mjs\'s snapshots: the status line and the toasts', async () => {
  expect(statusLine(RUNNING)).toBe('grimoire R1 · 1/7 tasks · 2 active · 1 failed · cost 41% · 3 stuck flags')
  expect(statusLine(HALTED)).toBe(undefined)
  expect(transitions({ ...HALTED, run: { ...HALTED.run!, status: 'running', haltReason: null } }, HALTED)).toContain('grimoire run R2 halted: budget_exhausted')
})
