#!/usr/bin/env node
// grimoire · skill evals before a push. Runs `claude plugin eval` for every skill a branch changes,
// on this machine and its Claude login (no API key, no CI bill), and remembers each pass by the
// skill's CONTENT, so a re-push, an amend or a rebase that leaves a skill as it was costs nothing.
//
//   node scripts/skill-evals.mjs                 evaluate the changed skills of HEAD that have not passed yet
//   node scripts/skill-evals.mjs --check         list them; exit 1 when any is left
//   node scripts/skill-evals.mjs --hook --head <sha>
//                                                what .githooks/pre-push runs per pushed ref: checks, and
//                                                evaluates what is left only from a terminal outside Claude
//                                                Code (a Bash tool call, a GUI client or another agent would
//                                                wait far too long); otherwise it prints the command
//   --base <ref>   what "changed" is measured against (default GRIMOIRE_EVALS_BASE, else origin/HEAD,
//                  origin/main, origin/master)
//   --skills a,b   these skills instead of the changed ones
//
// A skill's content is its directory and its generated cases (`evals/<skill>-<n>/`), read from the commit,
// and it is evaluated in a temporary detached worktree of that very commit, so what passes is exactly what
// is pushed. Passes are kept in the repository's common git dir (`grimoire-evals-passed.json`), shared by
// every worktree and never committed; a pass counts only at a threshold at least as strict as today's.
// Tuning: GRIMOIRE_EVALS_THRESHOLD (minimum score of every case, default 0.85), GRIMOIRE_EVALS_RUNS (runs
// per case, the CLI's default 3 when unset), GRIMOIRE_EVALS_CONCURRENCY (default 2),
// GRIMOIRE_EVALS_MAX_COST_USD (optional ceiling per skill), GRIMOIRE_EVALS_RUN_IN_HOOK (1: the hook
// evaluates even when not on a terminal; 0: it never does).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (k) => argv.includes(k)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const env = process.env
const HOOK = flag('--hook'), CHECK = flag('--check')
// `-c core.quotePath=false` and `-z` everywhere a path is read: git would otherwise quote a non-ASCII name
const git = (...a) => spawnSync('git', ['-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 64 << 20 })
const out = (...a) => { const r = git(...a); return r.status === 0 ? r.stdout.trim() : null }
const nul = (...a) => { const r = git(...a); return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null }
const say = (m) => process.stderr.write(`grimoire evals: ${m}\n`)

const ROOT = out('rev-parse', '--show-toplevel')
if (!ROOT) { say('not inside a git repository'); process.exit(HOOK ? 0 : 2) }
process.chdir(ROOT)
const COMMON = path.resolve(ROOT, out('rev-parse', '--git-common-dir') || '.git')
const STORE = path.join(COMMON, 'grimoire-evals-passed.json')
const THRESHOLD = env.GRIMOIRE_EVALS_THRESHOLD || '0.85'
const NAME = /^[a-z0-9][a-z0-9-]*$/
const HEAD = out('rev-parse', '--verify', '-q', `${opt('--head', 'HEAD')}^{commit}`) // a tag peels to its commit
if (!HEAD) { say(`cannot resolve ${opt('--head', 'HEAD')} to a commit`); process.exit(HOOK ? 0 : 2) }

// A path that belongs to skill `s`: its directory, or one of its generated cases.
const isMine = (p, s) => p.startsWith(`skills/${s}/`) || new RegExp(`^evals/${s}-\\d+/`).test(p)
const skillOf = (p) => (/^skills\/([^/]+)\//.exec(p) || /^evals\/(.+)-\d+\//.exec(p) || [])[1]
// Where "changed" starts: the merge base with the remote's default branch.
function mergeBase() {
  const candidates = [opt('--base', ''), env.GRIMOIRE_EVALS_BASE, 'origin/HEAD', 'origin/main', 'origin/master'].filter(Boolean)
  for (const b of candidates) {
    if (git('rev-parse', '--verify', '-q', `${b}^{commit}`).status !== 0) continue
    const mb = out('merge-base', b, HEAD)
    if (mb) return mb
  }
  return null
}
// The skills whose directory or generated cases differ between the merge base and HEAD, and that still
// have evals at HEAD. Renames are not followed: a file moved between two skills changes both.
function changedSkills() {
  let names
  const named = opt('--skills', '')
  if (named) names = named.split(/[,\s]+/).filter(Boolean)
  else {
    const mb = mergeBase()
    if (!mb) return null
    names = [...new Set((nul('diff', '-z', '--no-renames', '--name-only', mb, HEAD, '--', 'skills', 'evals') || []).map(skillOf).filter(Boolean))]
  }
  return names.filter((s) => NAME.test(s) && git('cat-file', '-e', `${HEAD}:skills/${s}/evals/evals.json`).status === 0)
}
// The skill's content at HEAD: the blobs of skills/<s>/ and of its generated cases evals/<s>-<n>/.
function contentHash(s) {
  const listing = (nul('ls-tree', '-r', '-z', HEAD, '--', `skills/${s}`, 'evals') || []).filter((l) => isMine(l.slice(l.indexOf('\t') + 1), s))
  return createHash('sha256').update(listing.join('\n')).digest('hex')
}
function load() {
  if (!existsSync(STORE)) return {}
  try { return JSON.parse(readFileSync(STORE, 'utf8')) } catch { say(`${STORE} is unreadable: starting it afresh`); return {} }
}
const passes = (rec) => !!rec && Number(rec.threshold) >= Number(THRESHOLD)
// Skills with uncommitted changes in their directory or their generated cases (porcelain -z: `XY path`,
// and a rename or copy is followed by its source path as one more entry).
function dirtySkills() {
  const entries = nul('status', '--porcelain', '-z', '--untracked-files=all', '--', 'skills', 'evals') || []
  const paths = []
  for (let i = 0; i < entries.length; i++) {
    paths.push(entries[i].slice(3))
    if (/^[RC]/.test(entries[i])) paths.push(entries[++i])
  }
  return [...new Set(paths.map(skillOf).filter(Boolean))]
}
const command = (skills) => `npm run evals:changed${skills.length ? ` -- --skills ${skills.join(',')}` : ''}`
const casesOf = (s) => { try { return JSON.parse(out('show', `${HEAD}:skills/${s}/evals/evals.json`)).length } catch { return '?' } }

// Evaluate each skill in a temporary detached worktree of HEAD, and record the ones that pass.
function run(todo) {
  if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).status !== 0) { say('the `claude` CLI is not on PATH'); return 2 }
  git('worktree', 'prune')
  const wt = path.join(mkdtempSync(path.join(tmpdir(), 'grimoire-evals-')), 'tree')
  if (git('worktree', 'add', '-q', '--detach', wt, HEAD).status !== 0) { say(`cannot check ${HEAD} out into a temporary worktree`); return 2 }
  const cleanup = () => { git('worktree', 'remove', '--force', wt); rmSync(path.dirname(wt), { recursive: true, force: true }) }
  // Ctrl-C reaches the eval and this script alike: the listener keeps node alive long enough for the
  // `finally` below to remove the temporary worktree (the loop stops on the eval's signal).
  const interrupted = () => { cleanup(); process.exit(130) }
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
  try {
    // the cases are generated from skills/*/evals/evals.json: stale ones would test the old expectations
    const gen = path.join(wt, 'scripts', 'build-evals.mjs')
    if (existsSync(gen) && spawnSync(process.execPath, [gen, '--check'], { stdio: 'ignore' }).status !== 0) { say('evals/ is stale in that commit: run `npm run evals:build` and commit it'); return 1 }
    // a run started from a Claude Code session (in the background) is an eval harness, not a nested session
    const childEnv = { ...env }
    delete childEnv.CLAUDECODE
    let failed = 0
    for (const { skill, hash } of todo) {
      const runs = env.GRIMOIRE_EVALS_RUNS || '3'
      say(`${skill}: ${casesOf(skill)} case(s) × ${runs} run(s), each a Claude Code session on your login; this can take a while…`)
      const results = path.join(ROOT, 'evals', 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}-${skill}`)
      const a = ['plugin', 'eval', wt, '--tag', skill, '--trust-plugin', '--ablation', 'none', '--no-publish', '-j', env.GRIMOIRE_EVALS_CONCURRENCY || '2', '--threshold', THRESHOLD, '--output-dir', results]
      if (env.GRIMOIRE_EVALS_RUNS) a.push('--runs', env.GRIMOIRE_EVALS_RUNS)
      if (env.GRIMOIRE_EVALS_MAX_COST_USD) a.push('--max-cost-usd', env.GRIMOIRE_EVALS_MAX_COST_USD)
      const r = spawnSync('claude', a, { stdio: ['ignore', 'inherit', 'inherit'], env: childEnv })
      if (r.signal === 'SIGINT' || r.signal === 'SIGTERM') { say(`${skill}: interrupted; nothing recorded`); return 130 }
      if (r.status === 0) {
        const passed = load()
        passed[hash] = { skill, commit: HEAD, at: new Date().toISOString(), threshold: THRESHOLD }
        writeFileSync(`${STORE}.tmp`, JSON.stringify(passed, null, 2) + '\n')
        renameSync(`${STORE}.tmp`, STORE)
        say(`${skill}: passed`)
      } else {
        failed++
        const why = r.status === 2 ? 'the cost ceiling was reached before every case ran' : r.status === 1 ? `a case scored below ${THRESHOLD}` : 'the eval did not complete'
        say(`${skill}: ${why} (exit ${r.status ?? r.signal}); the report is under ${path.relative(ROOT, results)}/`)
      }
    }
    return failed ? 1 : 0
  } finally {
    cleanup()
  }
}

const changed = changedSkills()
if (changed === null) {
  const msg = 'cannot find where this branch started (no origin/HEAD, origin/main or origin/master); set GRIMOIRE_EVALS_BASE or pass --base'
  if (HOOK) { say(`${msg}. Skill evals NOT checked for this push.`); process.exit(0) } // fail open, like the guard
  say(msg); process.exit(2)
}
const passed = load()
const todo = changed.map((s) => ({ skill: s, hash: contentHash(s) })).filter((x) => !passes(passed[x.hash]))
const names = todo.map((t) => t.skill)

if (HOOK || CHECK) {
  if (!todo.length) process.exit(0)
  const runHere = HOOK && !env.CLAUDECODE && env.GRIMOIRE_EVALS_RUN_IN_HOOK !== '0' && (env.GRIMOIRE_EVALS_RUN_IN_HOOK === '1' || !!process.stderr.isTTY)
  if (runHere) process.exit(run(todo))
  const here = out('rev-parse', 'HEAD')
  say(`these changed skills have not passed their evals on this content: ${names.join(', ')}`)
  say(here === HEAD ? `run: ${command(names)}` : `check out ${opt('--head', HEAD)} and run: ${command(names)}`)
  if (HOOK) say('then push again (`git push --no-verify` skips this check)')
  if (HOOK && env.CLAUDECODE) say('inside Claude Code: run it with run_in_background, it takes longer than a Bash call may')
  process.exit(1)
}
// By hand: uncommitted skill edits are refused even when the committed content has passed, so
// "nothing to run" never hides the edit you are making; what is evaluated is the commit.
const dirty = dirtySkills()
if (dirty.length) { say(`commit these first, a pass is recorded against committed content: ${dirty.join(', ')}`); process.exit(1) }
if (!todo.length) { say('nothing to run: every changed skill has passed on its current content'); process.exit(0) }
process.exit(run(todo))
