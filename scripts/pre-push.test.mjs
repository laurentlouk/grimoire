// grimoire · tests for .githooks/pre-push: CI's fast checks on the pushed commit, no key, no model.
//   Run:  node scripts/pre-push.test.mjs
// A throwaway repo built from this checkout's files (tracked and new, not ignored), so the hook and
// the checks under test are the ones in the working tree; real commits, and a real `git push` to a
// bare remote through `core.hooksPath`. Nothing here touches this repository.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, symlinkSync, chmodSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const section = (s) => console.log(`\n── ${s}`)

const T = mkdtempSync(path.join(tmpdir(), 'grim-pp-'))
process.on('exit', () => rmSync(T, { recursive: true, force: true }))
const W = path.join(T, 'work')
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', TMPDIR: T }
const sh = (cmd, extra = {}, cwd = W) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...ENV, ...extra } })
const git = (a, cwd = W) => { const r = sh(`git ${a}`, {}, cwd); if (r.status !== 0) throw new Error(`git ${a}: ${r.stderr}`); return r.stdout.trim() }
const commit = (m) => { git('add -A'); git(`commit -q -m ${JSON.stringify(m)}`); return git('rev-parse HEAD') }
const Z = '0'.repeat(40)
const hook = (lines, extra = {}) => spawnSync('sh', ['.githooks/pre-push', 'origin', 'url'], { cwd: W, input: lines.join('\n') + '\n', encoding: 'utf8', env: { ...ENV, ...extra } })
const ref = (sha, name = 'feat') => `refs/heads/${name} ${sha} refs/heads/${name} ${Z}`
const edit = (f, fn) => writeFileSync(path.join(W, f), fn(readFileSync(path.join(W, f), 'utf8')))
const leftovers = () => git('worktree list --porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length - 1

// the repo under test: this checkout's files, as they are now
const files = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
for (const f of files) {
  const from = path.join(REPO, f)
  if (!existsSync(from) || statSync(from).isDirectory()) continue
  mkdirSync(path.dirname(path.join(W, f)), { recursive: true })
  copyFileSync(from, path.join(W, f))
}
chmodSync(path.join(W, '.githooks', 'pre-push'), 0o755)
git('init -q -b main')
const GOOD = commit('good')

section('P-1 · a clean commit passes, quickly and quietly')
{
  const t0 = Date.now()
  const r = hook([ref(GOOD)])
  eq(r.status, 0, 'exit 0')
  eq(r.stderr.trim(), '', 'nothing to say')
  ok(Date.now() - t0 < 20000, `fast (${Date.now() - t0} ms)`)
  eq(leftovers(), 0, 'no temporary worktree left behind')
}

section('P-2 · a skill whose evals were edited without regenerating evals/ is blocked')
git('checkout -q -b stale')
edit('skills/tdd/evals/evals.json', (s) => s.replace(/"query": "/, '"query": "Please, '))
const STALE = commit('tdd cases edited, evals/ not rebuilt')
{
  const r = hook([ref(STALE, 'stale')])
  eq(r.status, 1, 'exit 1')
  ok(r.stderr.includes('refs/heads/stale: scripts/build-evals.mjs --check failed'), 'names the ref and the check')
  ok(r.stderr.includes('`git push --no-verify` skips this check'), 'names the way out')
  eq(leftovers(), 0, 'no temporary worktree left behind')
}

section('P-3 · drift is blocked too: a version bump without the harness manifest')
git('checkout -q main'); git('checkout -q -b drift')
edit('.claude-plugin/plugin.json', (s) => s.replace(/"version": "[^"]+"/, '"version": "9.9.9"'))
const DRIFT = commit('version bumped alone')
{
  const r = hook([ref(DRIFT, 'drift')])
  ok(r.status === 1 && r.stderr.includes('refs/heads/drift: scripts/check-drift.mjs failed') && r.stderr.includes('manifest'), 'the drift check fails, and says why')
}

section('P-4 · what is checked is the pushed commit, not the working tree')
git('checkout -q main')
edit('skills/tdd/evals/evals.json', (s) => s.replace(/"query": "/, '"query": "Uncommitted, '))
{
  eq(hook([ref(GOOD)]).status, 0, 'a broken, uncommitted working tree does not block a clean commit')
  git('checkout -q -- skills/tdd/evals/evals.json')
  eq(hook([ref(STALE, 'stale')]).status, 1, 'and a clean working tree does not save a broken commit')
}

section('P-5 · deletions, repeats, several refs')
{
  eq(hook([`(delete) ${Z} refs/heads/gone ${GOOD}`]).status, 0, 'a branch deletion is not checked')
  const both = hook([ref(STALE, 'stale'), ref(DRIFT, 'drift')])
  ok(both.status === 1 && both.stderr.includes('refs/heads/stale') && !both.stderr.includes('refs/heads/drift'), 'once one ref fails, the next is not checked (the push is blocked anyway)')
  const same = hook([ref(GOOD, 'a'), ref(GOOD, 'b')])
  eq(same.status, 0, 'the same commit under two refs passes, checked once')
}

section('P-6 · never wedges a push on its own problems')
{
  const NOBIN = path.join(T, 'nobin'); mkdirSync(NOBIN)
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), path.join(NOBIN, 'git'))
  const noNode = spawnSync('/bin/sh', ['.githooks/pre-push'], { cwd: W, input: ref(STALE, 'stale') + '\n', encoding: 'utf8', env: { ...ENV, PATH: NOBIN } })
  ok(noNode.status === 0 && noNode.stderr.includes('node is not on PATH, checks skipped'), 'without node: warns and lets the push through')
  const missing = hook([ref('1'.repeat(40), 'ghost')])
  ok(missing.status === 0 && missing.stderr.includes('cannot check out refs/heads/ghost'), 'a commit it cannot check out: warns and lets it through')
}

section('P-7 · through a real `git push`')
{
  git(`init -q --bare ${path.join(T, 'remote.git')}`, T)
  git(`remote add origin ${path.join(T, 'remote.git')}`)
  const blocked = sh('git -c core.hooksPath=.githooks push -q origin stale')
  ok(blocked.status !== 0 && blocked.stderr.includes('build-evals.mjs --check failed'), 'the broken branch is refused')
  ok(sh('git ls-remote origin refs/heads/stale').stdout.trim() === '', 'and never reaches the remote')
  const fine = sh('git -c core.hooksPath=.githooks push -q origin main')
  ok(fine.status === 0 && sh('git ls-remote origin refs/heads/main').stdout.includes(GOOD), 'the clean branch goes through')
  eq(leftovers(), 0, 'no temporary worktree left behind')
}

console.log(`\n${FAIL ? '✗' : '✓'} ${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
