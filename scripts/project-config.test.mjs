// grimoire · tests for scripts/project-config.mjs: grimoire.config.json read through from a linked
// worktree to its main checkout, and layered.
//   Run:  node scripts/project-config.test.mjs
// Real git repositories and worktrees in a temp dir; nothing here touches this repository.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mainCheckout, configLayers, mergeConfig, loadConfig, readConfig } from './project-config.mjs'

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'project-config.mjs')
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const section = (s) => console.log(`\n── ${s}`)

const T = realpathSync(mkdtempSync(path.join(tmpdir(), 'grim-pc-')))
process.on('exit', () => rmSync(T, { recursive: true, force: true }))
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
const write = (dir, value) => writeFileSync(path.join(dir, 'grimoire.config.json'), typeof value === 'string' ? value : JSON.stringify(value))
const cli = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' })

const MAIN = path.join(T, 'main')
mkdirSync(MAIN)
writeFileSync(path.join(MAIN, '.gitignore'), 'grimoire.config.json\n')
git(MAIN, 'init', '-q', '-b', 'main'); git(MAIN, 'add', '-A'); git(MAIN, 'commit', '-q', '-m', 'init')
const WT = path.join(T, 'wt')
git(MAIN, 'worktree', 'add', '-q', '-b', 'feat', WT)
const SHARED = { baseBranch: 'origin/dev', guard: { protectedBranches: ['main', 'dev'] }, graph: { exclude: ['gen'], maxFileKB: 256 }, repos: [{ name: 'a', path: '.' }] }
write(MAIN, SHARED)

section('C-1 · finding the main checkout')
{
  eq(mainCheckout(WT), MAIN, 'a linked worktree finds its main checkout')
  eq(mainCheckout(MAIN), null, 'the main checkout has none')
  eq(mainCheckout(T), null, 'a directory outside git has none')
}

section('C-2 · an untracked config reads through to the worktree')
{
  eq(configLayers(WT), [path.join(MAIN, 'grimoire.config.json')], 'the worktree has no file of its own: only the main one applies')
  eq(readConfig(WT), SHARED, 'the worktree sees the main checkout config as is')
  write(MAIN, { ...SHARED, baseBranch: 'origin/main' })
  eq(readConfig(WT).baseBranch, 'origin/main', 'an edit on the main checkout shows up in the worktree at once, nothing copied')
  write(MAIN, SHARED)
}

section('C-3 · the worktree file is layered over the main one')
{
  write(WT, { graph: { maxFileKB: 1024 }, repos: [{ name: 'b', path: 'b' }], manager: { share: null } })
  eq(configLayers(WT), [path.join(WT, 'grimoire.config.json'), path.join(MAIN, 'grimoire.config.json')], 'both layers, the worktree first')
  const c = readConfig(WT)
  eq(c.graph, { exclude: ['gen'], maxFileKB: 1024 }, 'objects merge key by key, the worktree wins')
  eq(c.repos, [{ name: 'b', path: 'b' }], 'an array from the worktree replaces the main one whole')
  eq(c.guard, SHARED.guard, 'a block the worktree does not set comes from main')
  eq(c.manager, { share: null }, 'a key only the worktree has is kept')
  eq(readConfig(MAIN), SHARED, 'the main checkout reads its own file only')
  rmSync(path.join(WT, 'grimoire.config.json'))
}

section('C-4 · broken layers')
{
  write(WT, '{ "token": "SECRET-VALUE", }')
  const r = loadConfig(WT)
  ok(!String(r.error).includes('SECRET-VALUE'), `the error never quotes the file's contents (${r.error})`)
  ok(r.config === null && /grimoire\.config\.json does not parse/.test(r.error), `a layer that does not parse is an error naming it (${r.error})`)
  eq(readConfig(WT), {}, 'readConfig fails open to {}')
  write(WT, '[1]')
  ok(/must be a JSON object/.test(loadConfig(WT).error), 'a top level that is not an object is an error')
  rmSync(path.join(WT, 'grimoire.config.json'))
  eq(loadConfig(T), { config: {}, files: [], error: null }, 'no config anywhere: {} and no error')
}

section('C-5 · mergeConfig')
{
  eq(mergeConfig({ a: { b: 1, c: 2 } }, { a: { c: 3 } }), { a: { b: 1, c: 3 } }, 'nested objects merge')
  eq(mergeConfig({ a: { b: 1 } }, { a: null }), { a: null }, 'null replaces')
  eq(mergeConfig({ a: [1, 2] }, { a: [3] }), { a: [3] }, 'arrays replace')
}

section('C-6 · the CLI')
{
  write(WT, { graph: { maxFileKB: 1 } })
  const r = cli('--root', WT)
  ok(r.status === 0 && JSON.parse(r.stdout).graph.maxFileKB === 1 && JSON.parse(r.stdout).baseBranch === 'origin/dev', 'prints the resolved config')
  eq(cli('--root', WT, '--sources').stdout, `${path.join(WT, 'grimoire.config.json')}\n${path.join(MAIN, 'grimoire.config.json')}\n`, '--sources lists the layers, the winning one first')
  write(WT, '{ nope')
  const bad = cli('--root', WT)
  ok(bad.status === 1 && bad.stderr.includes('does not parse'), 'exit 1 on a broken layer')
  eq(cli('--root', T).stdout, '{}\n', 'no config: {}')
}

console.log(`\n${FAIL ? '✗' : '✓'} ${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
