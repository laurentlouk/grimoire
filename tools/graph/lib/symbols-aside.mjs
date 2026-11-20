// grimoire graph · the definitions of files at a base ref, read in a process of its own, with the
// indexer's flags (V8's Liftoff-only WASM tier, lib/run.mjs): a grammar's crash costs this process,
// never the MCP server. graph_diff (change.mjs) compares them with the index's to tell a symbol
// added, removed, or changed (and whether its signature moved).
//
//   symbolsAside([{ path, lang, text }]) → Map(path → [{ kind, name, qualname, line, endLine, signature }] | Error)
//   node --liftoff-only symbols-aside.mjs  < JSON [{ path, lang, text }]  → JSON [{ symbols } | { error }]
//
// A signature is extract.mjs's: no literal's value in it.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const TIMEOUT_MS = 60_000

export function symbolsAside(items) {
  const out = new Map()
  if (!items.length) return out
  const run = (list) => {
    const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', '--stack-size=4000', HERE], { input: JSON.stringify(list), encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT_MS, killSignal: 'SIGKILL' })
    try { const got = JSON.parse(r.stdout); if (Array.isArray(got) && got.length === list.length) return got } catch {}
    return null
  }
  const got = run(items)
  if (got) { items.forEach((x, i) => out.set(x.path, got[i].error ? new Error(got[i].error) : got[i].symbols)); return out }
  // the batch failed whole: each file on its own, so one bad file loses only itself
  for (const x of items) {
    const one = run([x])
    out.set(x.path, !one ? new Error('the parser stopped on this file') : one[0].error ? new Error(one[0].error) : one[0].symbols)
  }
  return out
}

if (process.argv[1] === HERE) {
  const items = JSON.parse(readFileSync(0, 'utf8'))
  let rt = null, why = null
  try { rt = await (await import('./deps.mjs')).loadRuntime({ install: false }) } catch (e) { why = `no parser runtime: ${e.message}` }
  const { extract } = await import('./extract.mjs')
  const { TEST_PATH, LANGS } = await import('./langs.mjs')
  const { parseContract } = await import('./contracts.mjs')
  const out = []
  const pick = (s) => ({ kind: s.kind, name: s.name, qualname: s.qualname, line: s.line, endLine: s.endLine, signature: s.signature, isTest: s.isTest })
  for (const x of items) {
    try {
      // an API contract is read by hand (contracts.mjs), as the indexer reads it
      if (LANGS[x.lang]?.hand) {
        const r = parseContract(x.lang, x.text, TEST_PATH.test(x.path))
        // extend blocks attach their fields to the type they extend: the qualified name says so already
        out.push({ symbols: r.symbols.map(pick) })
        continue
      }
      if (!rt) throw new Error(why)
      const parser = await rt.parserFor(x.lang)
      if (!parser) throw new Error(`no ${x.lang} grammar`)
      const tree = parser.parse(x.text)
      try {
        const r = extract(tree, x.lang, TEST_PATH.test(x.path))
        out.push({ symbols: r.symbols.map((s) => ({ kind: s.kind, name: s.name, qualname: s.qualname, line: s.line, endLine: s.endLine, signature: s.signature, isTest: s.isTest })) })
      } finally { tree.delete() }
    } catch (e) { out.push({ error: String(e.message || e).split('\n')[0].slice(0, 200) }) }
  }
  process.stdout.write(JSON.stringify(out))
}
