// ════════════════════════════════════════════════════════════════════════════
//  Tests — economy/replay.mjs: the stuck watch over recorded runs, offline (#49)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/economy/replay.test.mjs
//
//  What this locks down, over a fixture Claude dir: each dispatch's calls go through the hook's own
//  fold; the role's envelope is learned from its earlier dispatches that ended green (causal: a
//  dispatch never gates itself); per role, the dispatches the gate opened on, the stuck ones, the
//  would-redirect / would-block verdicts of the free rules, the envelope and what the flagged
//  dispatches cost. No model is called.
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { replay, replayText } from './replay.mjs'
import { writeAgent, writeWorkflow, slugOf } from './fixtures.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)

const ROOT = mkdtempSync(join(tmpdir(), 'grimoire-replay-'))
const CLAUDE = join(ROOT, 'claude')
const WS = '/ws/proj'
const line = (o) => JSON.stringify(o)
// one call: the assistant's tool_use (1 output token, so each call costs 5 effective tokens) and its result
let n = 0
const callLines = (name, input, result, isError = false) => {
  const id = `t${++n}`
  return [line({ type: 'assistant', message: { id: `m${n}`, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 0, output_tokens: 1 } } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: result }] } })]
}
const FAIL_OUT = 'Traceback (most recent call last):\nAssertionError: 3 != 4\nFAILED (failures=1)'
// each line carries its time, as Claude Code writes it; the file names below sort against the start order
let clock = Date.parse('2026-11-01T00:00:00Z')
const stamp = (lines) => lines.map((l) => { const o = JSON.parse(l); o.timestamp = new Date(clock += 1000).toISOString(); return JSON.stringify(o) })
const green = () => [...callLines('Edit', { file_path: 'src/a.py' }, 'ok'), ...callLines('Edit', { file_path: 'src/a.py' }, 'ok'), ...callLines('Bash', { command: 'pytest -q' }, '3 passed in 0.10s')]
const spiral = (k) => Array.from({ length: k }, (_, i) => (i % 2 ? callLines('Bash', { command: 'pytest -q' }, FAIL_OUT, true) : callLines('Edit', { file_path: 'src/a.py' }, 'ok'))).flat()

const dir = writeWorkflow(join(CLAUDE, 'projects', slugOf(WS)), 's1', 'wf_1', 'R1')
// five green dispatches (3 calls each), then a spiral of 42 calls: envelope = p90(3) × 1.25 = 3.75; stuck from
// call 20 (past the 9.4-call backstop): would redirect, then 20 calls into its fresh segment, would block
;['T1', 'T2', 'T3', 'T4', 'T5'].forEach((t, i) => writeAgent(dir, `z${9 - i}`, stamp(green()), { agentType: 'backend-engineer', description: `impl:${t}` }))
writeAgent(dir, 'a0', stamp(spiral(42)), { agentType: 'backend-engineer', description: 'impl:T6' }) // started last, sorts first
// a reviewer that only reads: never gated
writeAgent(dir, 'b6', callLines('Read', { file_path: 'src/a.py' }, "assert x\nraise ValueError('no')"), { agentType: 'grimoire:reviewer', description: 'spec-hawk:T6#1' })
const runs = [{ runId: 'R1', events: [{ type: 'run.start', repos: ['api'] }, ...['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((t) => ({ type: 'dispatch', task: t, repo: 'api' }))] }]

try {
  const r = replay(runs, { claudeDir: CLAUDE, roots: [WS] })
  eq(r, {
    runs: 1,
    roles: {
      'api/backend-engineer': { dispatches: 6, gated: 1, stuck: 1, wouldRedirect: 1, wouldBlock: 1, envelope: 3.75, flaggedCost: 42 * 5 },
      'api/grimoire:reviewer': { dispatches: 1, gated: 0, stuck: 0, wouldRedirect: 0, wouldBlock: 0, envelope: null, flaggedCost: 0 },
    },
  }, 'per role: the spiral is gated and stuck, would be redirected then blocked past the envelope its earlier green dispatches set, and its cost is flagged')
  const text = replayText(r)
  ok(text.includes('api/backend-engineer') && /6 dispatches · gated 1 · stuck 1 · would redirect 1 · would block 1 · envelope 3\.8 calls · flagged cost 210/.test(text),
    `the table (${text.split('\n').find((l) => l.includes('backend')) || text})`)
  const cli = spawnSync(process.execPath, [new URL('./replay.mjs', import.meta.url).pathname, '--json', '--claude-dir', CLAUDE, '--dir', join(ROOT, 'none')], { cwd: ROOT, encoding: 'utf8' })
  eq([cli.status, JSON.parse(cli.stdout || '{}')], [0, { runs: 0, roles: {} }], 'the CLI over a dir with no runs: nothing replayed, exit 0')
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
