// grimoire · tests for scripts/skill-evals.mjs and .githooks/pre-push.
//   Run:  node scripts/skill-evals.test.mjs
// A temp repo holding copies of the two scripts, skills with generated evals, and a fake `claude` on PATH
// that logs what it was asked to evaluate (and the SKILL.md it found there) and exits as told: nothing
// here runs a real eval or costs anything.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync, existsSync, renameSync, symlinkSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '..')
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const section = (s) => console.log(`\n── ${s}`)

const T = mkdtempSync(path.join(tmpdir(), 'grim-se-'))
process.on('exit', () => rmSync(T, { recursive: true, force: true }))
const W = path.join(T, 'work'), BIN = path.join(T, 'bin'), LOG = path.join(T, 'claude.log')
mkdirSync(path.join(W, 'scripts'), { recursive: true }); mkdirSync(BIN)
for (const f of ['skill-evals.mjs', 'build-evals.mjs']) copyFileSync(path.join(REPO, 'scripts', f), path.join(W, 'scripts', f))
mkdirSync(path.join(W, '.githooks')); copyFileSync(path.join(REPO, '.githooks', 'pre-push'), path.join(W, '.githooks', 'pre-push'))
writeFileSync(path.join(BIN, 'claude'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const a = process.argv.slice(2)
if (a[0] === '--version') { console.log('9.9.9'); process.exit(0) }
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null }
const target = a[2], tag = opt('--tag')
const body = fs.readFileSync(path.join(target, 'skills', tag, 'SKILL.md'), 'utf8').trim().split('\\n').pop()
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ tag, target, body, j: opt('-j'), threshold: opt('--threshold'), runs: opt('--runs'), cost: opt('--max-cost-usd'), out: opt('--output-dir'), claudecode: process.env.CLAUDECODE || null }) + '\\n')
process.exit(Number(process.env.FAKE_EVAL_EXIT || 0))
`)
chmodSync(path.join(BIN, 'claude'), 0o755)

const ENV = { ...process.env, PATH: `${BIN}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
for (const k of Object.keys(ENV)) if (k.startsWith('GRIMOIRE_EVALS_') || k === 'CLAUDECODE') delete ENV[k] // these tests run inside Claude Code too
ENV.GRIMOIRE_EVALS_BASE = 'main'
const sh = (cmd, extra = {}, cwd = W) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...ENV, ...extra } })
const git = (a) => { const r = sh(`git ${a}`); if (r.status !== 0) throw new Error(`git ${a}: ${r.stderr}`); return r.stdout.trim() }
const se = (args = '', extra = {}, cwd = W) => sh(`node scripts/skill-evals.mjs ${args}`, extra, cwd)
const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const resetLog = () => rmSync(LOG, { force: true })
const skill = (name, body = 'Do it.') => {
  mkdirSync(path.join(W, 'skills', name, 'evals'), { recursive: true })
  writeFileSync(path.join(W, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use for ${name}.\n---\n\n${body}\n`)
  writeFileSync(path.join(W, 'skills', name, 'evals', 'evals.json'), JSON.stringify([
    { id: 1, query: `do ${name}`, should_trigger: true, expected_output: 'it does', expectations: [{ text: 'does it', passed: null, evidence: '' }] },
    { id: 2, query: 'something else', should_trigger: false, expected_output: 'it does not', expectations: [{ text: 'does not', passed: null, evidence: '' }] },
  ], null, 2))
}
const build = () => sh('node scripts/build-evals.mjs')
const commit = (m) => { git('add -A'); git(`commit -q -m ${JSON.stringify(m)}`); return git('rev-parse HEAD') }
const store = () => JSON.parse(readFileSync(path.join(W, '.git', 'grimoire-evals-passed.json'), 'utf8'))
const Z = '0'.repeat(40)
const push = (lines, extra = {}) => spawnSync('sh', ['.githooks/pre-push', 'origin', 'url'], { cwd: W, input: lines.join('\n') + '\n', encoding: 'utf8', env: { ...ENV, ...extra } })

git('init -q -b main')
skill('alpha'); skill('beta'); build(); commit('base')
git('checkout -q -b feat')
skill('alpha', 'Do it better.'); build(); commit('alpha v2')

section('S-1 · --check lists only the changed skill, before any pass')
{
  const r = se('--check')
  eq(r.status, 1, 'exit 1')
  ok(/not passed their evals on this content: alpha$/m.test(r.stderr), 'names alpha, not beta')
  ok(r.stderr.includes('run: npm run evals:changed -- --skills alpha'), 'gives the command')
}

section('S-2 · a run evaluates the committed skill in a temporary worktree and records the pass')
{
  resetLog()
  const r = se('', { CLAUDECODE: '1' })
  eq(r.status, 0, 'exit 0')
  const [c] = calls()
  eq(calls().length, 1, 'one eval, for the one changed skill')
  ok(c.tag === 'alpha' && c.target !== W && c.target !== '.' && !existsSync(c.target), 'in a temporary worktree, removed afterwards')
  eq(c.body, 'Do it better.', 'of the committed content')
  eq([c.threshold, c.j, c.runs, c.cost], ['0.85', '2', null, null], 'default threshold and concurrency; runs and cost left to the CLI')
  ok(c.out.startsWith(path.join(realpathSync(W), 'evals', 'results') + path.sep), 'the report lands in the repo, under the git-ignored evals/results/')
  eq(c.claudecode, null, 'the eval is not told it is nested in a Claude Code session')
  ok(!git('worktree list --porcelain').includes('grimoire-evals-'), 'no temporary worktree left registered')
  eq(Object.values(store()).map((v) => [v.skill, v.threshold]), [['alpha', '0.85']], 'the pass is kept in the common git dir, with its threshold')
  eq(se('--check').status, 0, '--check passes now')
  resetLog(); eq([se().status, calls().length], [0, 0], 'a second run has nothing to do')
}

section('S-3 · the same content under a new commit stays passed')
{
  git('commit -q --amend -m "alpha v2, reworded"')
  eq(se('--check').status, 0, 'an amend that keeps the content needs no re-run')
  const wt = path.join(T, 'wt')
  git(`worktree add -q ${wt} HEAD`)
  eq(se('--check', {}, wt).status, 0, 'and another worktree of the repo sees the same pass')
  git(`worktree remove --force ${wt}`)
}

section('S-4 · failures, exit codes and knobs')
{
  skill('alpha', 'Do it differently.'); build(); commit('alpha v3')
  resetLog()
  const r = se('', { FAKE_EVAL_EXIT: '1' })
  ok(r.status === 1 && r.stderr.includes('alpha: a case scored below 0.85 (exit 1)'), 'a failing case: exit 1, said so')
  eq(se('--check').status, 1, 'and nothing recorded')
  const c = se('', { FAKE_EVAL_EXIT: '2' })
  ok(c.status === 1 && c.stderr.includes('the cost ceiling was reached'), 'exit 2 from the CLI is reported as the cost ceiling')
  const d = se('', { FAKE_EVAL_EXIT: '7' })
  ok(d.status === 1 && d.stderr.includes('the eval did not complete'), 'any other exit is not called a low score')
  resetLog(); se('', { FAKE_EVAL_EXIT: '1', GRIMOIRE_EVALS_MAX_COST_USD: '3', GRIMOIRE_EVALS_THRESHOLD: '0.9', GRIMOIRE_EVALS_CONCURRENCY: '4', GRIMOIRE_EVALS_RUNS: '1' })
  const [k] = calls()
  eq([k.threshold, k.j, k.runs, k.cost], ['0.9', '4', '1', '3'], 'threshold, concurrency, runs and the cost ceiling come from the environment')
}

section('S-5 · a pass counts only at a threshold at least as strict as today')
{
  eq(se('', { GRIMOIRE_EVALS_THRESHOLD: '0.5' }).status, 0, 'passed at 0.5')
  eq(se('--check', { GRIMOIRE_EVALS_THRESHOLD: '0.5' }).status, 0, 'counts at 0.5')
  eq(se('--check').status, 1, 'does not count at the default 0.85')
  eq(se().status, 0, 'passed again at 0.85')
  eq(se('--check', { GRIMOIRE_EVALS_THRESHOLD: '0.5' }).status, 0, 'which also counts at 0.5')
}

section('S-6 · by hand it refuses uncommitted skill edits, even over a recorded pass')
{
  writeFileSync(path.join(W, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for alpha.\n---\n\nUncommitted.\n')
  writeFileSync(path.join(W, 'skills', 'beta', 'café.md'), 'note\n')
  resetLog()
  const r = se()
  ok(r.status === 1 && r.stderr.includes('commit these first') && r.stderr.includes('alpha') && r.stderr.includes('beta'), 'both refused, a non-ASCII untracked file included')
  eq(calls().length, 0, 'no eval was run')
  git('checkout -q -- skills/alpha/SKILL.md'); rmSync(path.join(W, 'skills', 'beta', 'café.md'))
}

section('S-7 · it refuses to run stale generated cases')
{
  const f = path.join(W, 'skills', 'alpha', 'evals', 'evals.json')
  const cases = JSON.parse(readFileSync(f, 'utf8')); cases[0].query = 'do alpha, carefully'
  writeFileSync(f, JSON.stringify(cases, null, 2)); commit('alpha cases edited, evals/ not rebuilt')
  resetLog()
  const r = se()
  ok(r.status === 1 && r.stderr.includes('evals/ is stale'), 'stale evals/ is refused')
  eq(calls().length, 0, 'no eval was run')
  build(); commit('rebuild'); eq(se().status, 0, 'rebuilt: it runs')
}

section('S-8 · what changes a skill')
{
  writeFileSync(path.join(W, 'evals', 'alpha-1', 'prompt.md'), readFileSync(path.join(W, 'evals', 'alpha-1', 'prompt.md'), 'utf8') + '\n')
  commit('a generated case changed alone (as a generator change would)')
  ok(/: alpha$/m.test(se('--check').stderr), 'a change in evals/alpha-<n>/ alone')
  build(); commit('back'); se()
  writeFileSync(path.join(W, 'skills', 'alpha', 'référence.md'), 'ref\n'); commit('a non-ASCII file in alpha')
  ok(/: alpha$/m.test(se('--check').stderr), 'a new file with a non-ASCII name')
  se()
  renameSync(path.join(W, 'skills', 'alpha', 'référence.md'), path.join(W, 'skills', 'beta', 'référence.md')); commit('moved to beta')
  // alpha without the file is content that already passed, so the cache rightly keeps it: clear the
  // cache to see what change detection alone reports
  const kept = readFileSync(path.join(W, '.git', 'grimoire-evals-passed.json'), 'utf8'); rmSync(path.join(W, '.git', 'grimoire-evals-passed.json'))
  ok(/: alpha, beta$/m.test(se('--check').stderr), 'a file moved between two skills changes both')
  writeFileSync(path.join(W, '.git', 'grimoire-evals-passed.json'), kept)
  se()
}

section('S-9 · the hook: who may evaluate, and which content')
{
  skill('alpha', 'Fifth version.'); build(); const head = commit('alpha v5')
  resetLog()
  const inClaude = se(`--hook --head ${head}`, { CLAUDECODE: '1', GRIMOIRE_EVALS_RUN_IN_HOOK: '1' })
  ok(inClaude.status === 1 && inClaude.stderr.includes('run: npm run evals:changed -- --skills alpha') && inClaude.stderr.includes('run_in_background'), 'inside Claude Code: blocked with the command, even with RUN_IN_HOOK=1')
  const noTty = se(`--hook --head ${head}`)
  ok(noTty.status === 1 && noTty.stderr.includes('run: npm run evals:changed'), 'not a terminal (a GUI client, another agent): blocked with the command')
  eq(se(`--hook --head ${head}`, { GRIMOIRE_EVALS_RUN_IN_HOOK: '0' }).status, 1, 'RUN_IN_HOOK=0: never evaluates')
  eq(calls().length, 0, 'none of those ran an eval')
  // a ref that is not checked out: evaluated as pushed, not as the checked-out tree
  git('checkout -q -b other'); skill('alpha', 'The other branch.'); build(); const other = commit('other alpha'); git('checkout -q feat')
  const away = se(`--hook --head ${other}`)
  ok(away.status === 1 && away.stderr.includes(`check out ${other} and run`), 'not checked out, not a terminal: says to check it out first')
  resetLog()
  eq(se(`--hook --head ${other}`, { GRIMOIRE_EVALS_RUN_IN_HOOK: '1' }).status, 0, 'RUN_IN_HOOK=1: evaluates it')
  eq(calls().map((c) => c.body), ['The other branch.'], 'the pushed content, not the checked-out one')
  eq(se(`--hook --head ${other}`).status, 0, 'and that content now passes')
  eq(se(`--hook --head ${head}`, { CLAUDECODE: '1' }).status, 1, 'while the checked-out head still does not')
  git(`tag -a v5 -m v5 ${head}`)
  const tagObj = git('rev-parse v5')
  ok(tagObj !== head && se(`--hook --head ${tagObj}`, { CLAUDECODE: '1' }).stderr.includes('alpha'), 'an annotated tag is peeled to its commit')
}

section('S-10 · .githooks/pre-push, fed the refs git gives it')
{
  const head = git('rev-parse feat'), other = git('rev-parse other')
  resetLog()
  const blocked = push([`refs/heads/feat ${head} refs/heads/feat ${Z}`], { CLAUDECODE: '1' })
  ok(blocked.status === 1 && blocked.stderr.includes('git push --no-verify'), 'blocks a push of an un-evaluated skill, naming the way out')
  eq(push([`(delete) ${Z} refs/heads/gone ${head}`]).status, 0, 'a branch deletion is not checked')
  git('checkout -q -b third'); skill('alpha', 'A third branch.'); build(); const third = commit('third alpha'); git('checkout -q feat')
  resetLog()
  const two = push([`refs/heads/feat ${head} refs/heads/feat ${Z}`, `refs/heads/third ${third} refs/heads/third ${Z}`], { GRIMOIRE_EVALS_RUN_IN_HOOK: '1', FAKE_EVAL_EXIT: '1' })
  ok(two.status === 1 && calls().length === 1, 'once a ref is blocked the push is: the next ref is checked, not evaluated')
  ok(two.stderr.includes(`check out ${third}`), 'and still named')
  resetLog()
  const ran = push([`refs/heads/feat ${head} refs/heads/feat ${Z}`, `refs/heads/other ${other} refs/heads/other ${Z}`], { GRIMOIRE_EVALS_RUN_IN_HOOK: '1' })
  ok(ran.status === 0 && calls().length === 1, 'evaluates what is left (feat), skips what passed (other), then lets the push through')
  eq(push([`refs/heads/feat ${head} refs/heads/feat ${Z}`], { CLAUDECODE: '1' }).status, 0, 'and the next push is instant')
  // no node: a PATH holding only git
  const NOBIN = path.join(T, 'nobin'); mkdirSync(NOBIN)
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), path.join(NOBIN, 'git'))
  const noNode = spawnSync('/bin/sh', ['.githooks/pre-push'], { cwd: W, input: `refs/heads/third ${third} refs/heads/third ${Z}\n`, encoding: 'utf8', env: { ...ENV, PATH: NOBIN } })
  ok(noNode.status === 0 && noNode.stderr.includes('node is not on PATH, skill evals not checked'), 'without node: warns and lets the push through')
}

section('S-11 · no base to measure "changed" against')
{
  const h = se(`--hook --head ${git('rev-parse HEAD')}`, { GRIMOIRE_EVALS_BASE: '' })
  ok(h.status === 0 && h.stderr.includes('GRIMOIRE_EVALS_BASE') && h.stderr.includes('NOT checked'), 'the hook fails open, loudly, naming the setting')
  const c = se('--check', { GRIMOIRE_EVALS_BASE: '' })
  ok(c.status === 2 && c.stderr.includes('GRIMOIRE_EVALS_BASE'), 'by hand: exit 2, naming the setting')
}

section('S-12 · a deleted skill, and a change outside skills/, need nothing')
{
  rmSync(path.join(W, 'skills', 'beta'), { recursive: true }); build(); commit('drop beta')
  writeFileSync(path.join(W, 'README.md'), 'readme\n'); commit('readme')
  eq(se('--check').status, 0, 'nothing left to evaluate')
}

console.log(`\n${FAIL ? '✗' : '✓'} ${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
