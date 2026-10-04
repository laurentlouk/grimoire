// Shared by run-durability-final.test.mjs: drives the engine with stubbed agents (like every
// workflows/tests file) and runs the ship, seal and gate scripts it generates for real against a
// temp git sandbox with a fake gh that tracks isDraft, body, comments and its op log.
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export { spawn, spawnSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync, join }
const DIR = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
export const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')
export const tick = (ms) => new Promise((r) => setTimeout(r, ms))
export const later = (v, ms = 15) => tick(ms).then(() => v)
export const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
export const heredocs = (prompt) => [...prompt.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => unb64(m[1]))
export const API = { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }
export const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: [API] }
export const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
export const RUN_BRANCH = 'feat/proj-700-api'
export const PR_URL = 'https://github.com/x/y/pull/7'
export const T = (id, extra = {}) => ({ id, ticket: id, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: `Build ${id}`, deferred: false, files: [`src/${id.replace(/\W/g, '')}.ts — add it`], ...extra })
export const impl = (head, start = '0000000', summary = `built ${head}`) => ({ status: 'DONE', summary, commits: [head], baseSha: '0000000', startSha: start, headSha: head, filesChanged: [] })
export const BLOCKED = { status: 'BLOCKED', summary: 'stuck', concerns: 'cannot proceed' }
export const V = (verdict) => ({ verdict, findings: [], summary: verdict })
export const headOf = (p) => (/landed head `([0-9a-f]+)`/.exec(p) || [])[1]
export const checksIn = (p) => [...p.matchAll(/\bsay (?:'([^']+)'|(power)) /g)].map((m) => m[1] || m[2])
export const envReport = (p, fail = {}) => ({ results: checksIn(p).map((name) => ({ name, exit: fail[name] ?? 0, output: '' })) })
export const happy = (label, p) => {
  if (label.startsWith('impl:')) return impl('aaaaaaa')
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: PR_URL }
  if (label.startsWith('ship:')) return { pushed: true, remoteHead: headOf(p), prUrl: PR_URL, draft: true }
  if (label.startsWith('seal:')) return { sealed: true, already: true, prUrl: PR_URL }
  if (label.startsWith('env:')) return envReport(p)
  if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'eeeeeee' }
  return V('PASS')
}
export const by = (map) => (label, p, o, calls) => (label in map ? (typeof map[label] === 'function' ? map[label](p, o, calls) : map[label]) : happy(label, p))
export const indexOf = (tasks, extra) => ({
  slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: t.title || `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })) }],
  hookProblems: [], ...extra,
})
export async function run(scenario, tasks, responder, { args = {}, index = {} } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return typeof index === 'function' ? index(prompt) : indexOf(tasks, index)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map((t) => ({ ...t })) }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return { reports: [], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], prUrl: '', summary: '' }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  const labels = calls.map((c) => c.label)
  return { result, calls, logs, labels, prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}
export const SHELLS = ['bash', 'zsh', 'dash'].filter((s) => spawnSync('sh', ['-c', `command -v ${s}`]).status === 0)
export const HAS_JQ = spawnSync('sh', ['-c', 'command -v jq']).status === 0
export const GITENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
export const fakeGh = (S) => `#!${process.execPath}
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process')
const S = ${JSON.stringify(S)}
const rd = (f, d = '') => { try { return fs.readFileSync(path.join(S, f), 'utf8') } catch (e) { return d } }
const wr = (f, v) => fs.writeFileSync(path.join(S, f), v)
const log = (x) => fs.appendFileSync(path.join(S, 'log'), x + '\\n')
const a = process.argv.slice(2), op = a[0] + ' ' + a[1]
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
if (rd('failview') && op === 'pr view') { log('view-failed'); process.stderr.write('HTTP 502\\n'); process.exit(1) }
const url = rd('url').trim()
const delay = Number(rd('delay', '0'))
if (delay && (op === 'pr edit' || op === 'pr ready')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay) }
if (op === 'pr list') { if (url && rd('state', 'OPEN').trim() === 'OPEN') process.stdout.write(url + '\\n'); process.exit(0) }
if (op === 'pr create') { wr('url', 'https://github.com/x/y/pull/9'); wr('draft', a.includes('--draft') ? 'true' : 'false'); wr('body', fs.readFileSync(opt('--body-file'), 'utf8')); log('create'); process.stdout.write('https://github.com/x/y/pull/9\\n'); process.exit(0) }
if (op === 'pr edit') { wr('body', fs.readFileSync(opt('--body-file'), 'utf8')); log('edit'); process.exit(0) }
if (op === 'pr comment') { fs.appendFileSync(path.join(S, 'comments'), fs.readFileSync(opt('--body-file'), 'utf8') + '\\n<<<END>>>\\n'); log('comment'); process.exit(0) }
if (op === 'pr ready') { wr('draft', 'false'); log('ready'); process.exit(0) }
if (op === 'pr view') {
  const all = { isDraft: rd('draft', 'true').trim() === 'true', body: rd('body') }
  const json = {}; for (const f of (opt('--json') || '').split(',')) json[f] = all[f]
  const jq = opt('--jq')
  const r = spawnSync('jq', ['-r', jq], { input: JSON.stringify(json), encoding: 'utf8' }); process.stdout.write(r.stdout); process.exit(r.status || 0)
}
process.exit(0)
`
export function sandbox() {
  const T0 = mkdtempSync(join(tmpdir(), 'grim-rv10-'))
  const sh = (cmd, cwd = T0) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: GITENV }).stdout.trim()
  const GH = join(T0, 'gh-state'), BIN = join(T0, 'bin')
  mkdirSync(GH); mkdirSync(BIN)
  writeFileSync(join(BIN, 'gh'), fakeGh(GH)); chmodSync(join(BIN, 'gh'), 0o755)
  sh('git init -q --bare -b main origin.git && git clone -q origin.git work 2>/dev/null')
  const W = join(T0, 'work')
  sh(`git commit -q --allow-empty -m base && git push -q origin main && git checkout -q -b ${RUN_BRANCH}`, W)
  const file = (f, d = '') => { try { return readFileSync(join(GH, f), 'utf8') } catch (e) { return d } }
  return {
    T0, W, sh, GH, BIN,
    commit: (m) => sh(`git commit -q --allow-empty -m ${m} && git rev-parse HEAD`, W),
    origin: () => sh(`git --git-dir=origin.git rev-parse -q --verify refs/heads/${RUN_BRANCH}`),
    pr: { draft: () => file('draft', 'true').trim(), body: () => file('body'), comments: () => file('comments').split('\n<<<END>>>\n').filter((c) => c.trim()), ops: () => file('log').trim().split('\n').filter(Boolean), set: (f, v) => writeFileSync(join(GH, f), v) },
    exec: (shell, script, env = {}, opts = {}) => {
      const t = Date.now()
      const r = spawnSync(shell, ['-c', script], { cwd: T0, encoding: 'utf8', env: { ...GITENV, PATH: `${BIN}:${process.env.PATH}`, ...env }, maxBuffer: 1 << 28, ...opts })
      return { out: r.stdout || '', err: r.stderr || '', ms: Date.now() - t, status: r.status, signal: r.signal }
    },
    done: () => rmSync(T0, { recursive: true, force: true }),
  }
}
export const scriptOf = (p) => (/```bash\n([\s\S]*?)\n```/.exec(p) || [])[1] || ''
export const realRepo = (W, extra = {}) => [{ name: 'api', path: W, agent: 'backend-engineer', tags: ['backend'], gate: null, ...extra }]
export const receipt = (out) => {
  const push = /^PUSH ok=(\d)(?: hook=(\d))?/m.exec(out) || []
  const pr = /^PR ok=(\d)(?: url=(\S*))?/m.exec(out) || []
  const draft = /^DRAFT (\w+)/m.exec(out)
  const failedStep = push[1] === '0' ? 'push' : pr[1] === '0' ? 'pr' : /^COMMENT ok=0/m.test(out) ? 'comment' : undefined
  return { pushed: push[1] === '1', remoteHead: (/^PUSH ok=1 remote=(\S+)/m.exec(out) || [])[1] || '', prUrl: pr[2] || (/^READY url=(\S+)/m.exec(out) || [])[1] || '', draft: draft ? draft[1] === 'true' : undefined, hookBlocked: push[2] === '1', ready: /^READY /m.test(out), lockBusy: /^LOCK busy/m.test(out), failedStep, detail: out.slice(-300) }
}
// the ship script of a landing, pointed at a sandbox
export async function getScripts(X, c1, extra = {}) {
  const got = {}
  await run('(capture scripts)', [T('PROJ-1')], by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'ship:api#1': (p) => { got.land = p; return { pushed: false, failedStep: 'push' } }, 'gate:api': (p) => { got.gate = p; return { status: 'DONE', summary: 'g', prUrl: PR_URL } }, 'seal:api': (p) => { got.seal = p; return { sealed: true } } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false, ...extra } })
  return got
}
