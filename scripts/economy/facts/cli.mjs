#!/usr/bin/env node
// grimoire · economy · facts CLI: the learned environment facts, read from outside the hook.
//
//   node scripts/economy/facts/cli.mjs render --root <dir> --repos <a,b>
//     → JSON {"repos": {<repo>: {"block": "...", "ids": [...]}}} for each listed repo whose store
//       has something to show; the loop's harness-context loader runs it once per run and pastes
//       each block into that repo's briefs (token economy slice 7). Read-only.
//   node scripts/economy/facts/cli.mjs durable --root <dir> [--min-folds 10]
//     → JSON [{repo, id, family, claim, activeFolds, fired, exercised}]: the facts active for at
//       least that many of their repo's folds, which crystallize may propose as memory entries.
//
// The stores are `.grimoire/economy/facts/<repo>.json` in the main checkout of <dir>.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { economyDir } from '../paths.mjs'
import { fromJSON, render, injectedIds } from './families.mjs'
import { claim } from './render.mjs'

const NAME = /^[A-Za-z0-9._-]{1,128}$/
const readStore = (dir, repo) => { try { return fromJSON(readFileSync(join(dir, `${repo}.json`), 'utf8'), repo) } catch { return null } }

/** Each listed repo's block and the ids it shows, for repos whose store has something to show. */
export function renderRepos(root, repos) {
  const dir = join(economyDir(root), 'facts')
  const out = {}
  for (const repo of repos) {
    if (!NAME.test(repo)) continue
    const store = readStore(dir, repo)
    const block = store ? render(store) : ''
    if (block) out[repo] = { block, ids: injectedIds(store) }
  }
  return { repos: out }
}

/** The facts active for at least `minFolds` of their repo's folds, longest-lived first. */
export function durableFacts(root, { minFolds = 10 } = {}) {
  const dir = join(economyDir(root), 'facts')
  let names = []
  try { names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'folded.json') } catch {}
  const out = []
  for (const f of names.sort()) {
    const repo = f.slice(0, -'.json'.length)
    const store = readStore(dir, repo)
    if (!store) continue
    for (const fact of Object.values(store.facts)) {
      const l = fact.life
      if (l.state !== 'ACTIVE' || !Number.isInteger(l.promotedAt)) continue
      const activeFolds = store.now - l.promotedAt
      if (activeFolds < minFolds) continue
      out.push({ repo, id: fact.id, family: fact.family, claim: claim(fact), activeFolds, fired: l.fireNum, exercised: l.fireDen })
    }
  }
  return out.sort((a, b) => b.activeFolds - a.activeFolds || a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id))
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) {
  const argv = process.argv.slice(2)
  const arg = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const root = resolve(arg('root') ?? process.cwd())
  if (argv[0] === 'render' && arg('repos') !== null) console.log(JSON.stringify(renderRepos(root, arg('repos').split(',').map((s) => s.trim()).filter(Boolean))))
  else if (argv[0] === 'durable') {
    const n = Number(arg('min-folds') ?? 10)
    console.log(JSON.stringify(durableFacts(root, { minFolds: Number.isInteger(n) && n >= 0 ? n : 10 })))
  } else {
    console.error('usage: node scripts/economy/facts/cli.mjs render --root <dir> --repos <a,b> | durable --root <dir> [--min-folds N]')
    process.exitCode = 2
  }
}
