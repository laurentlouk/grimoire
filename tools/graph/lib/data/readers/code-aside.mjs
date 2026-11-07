// grimoire graph · data · source code read by the code extractors (extractors/serde.mjs,
// extractors/ts-types.mjs) in a process of its own, for what reads code outside the indexer's process:
// the model at a base ref (data/base.mjs) is built where graph_changes and the page run, the MCP
// server's process, so its Rust and TypeScript are parsed here, with the indexer's flags (V8's
// Liftoff-only WASM tier, lib/run.mjs), as readers/yaml-aside.mjs does for YAML: a grammar's crash
// costs this process, never the server.
//
//   extractAside([{ id, path, text }]) → Map(path → facts | Error)
//   node --liftoff-only code-aside.mjs  < JSON [{ id, path, text }]  → JSON [{ facts } | { error }]
//
// Bounded: the files go in batches (BATCH texts or BATCH_BYTES, whichever comes first), each batch a
// process killed past BATCH_MS; all of them share TOTAL_MS, past which the files left are not read.
// A batch that crashes or runs out of time is read again file by file, each in a process of its own,
// so a file that crashes the reader or takes too long fails alone.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
export const CODE_LANGS = ['rust', 'typescript', 'tsx']
export const BATCH = 200, BATCH_BYTES = 8 << 20, BATCH_MS = 30_000, TOTAL_MS = 60_000

export function extractAside(items, { batchMs = BATCH_MS, totalMs = TOTAL_MS } = {}) {
  const out = new Map()
  const end = Date.now() + totalMs
  const late = () => new Error(`the time for code at the base (${totalMs / 1000} s) ran out: not read`)
  // one process over a list: [{ facts } | { error }] in its order, or { why } when the process failed
  const spawn = (list, left) => {
    const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', '--stack-size=4000', HERE], { input: JSON.stringify(list), encoding: 'utf8', maxBuffer: 1 << 28, timeout: Math.min(batchMs, left), killSignal: 'SIGKILL' })
    let got = null
    try { got = JSON.parse(r.stdout) } catch {}
    if (Array.isArray(got) && got.length === list.length) return got
    return { why: r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null) ? 'the code took too long to read: not read' : `the code reader stopped (${r.status ?? r.signal}): not read` }
  }
  const settle = (x, g) => out.set(x.path, g.error ? new Error(g.error) : g.facts)
  for (let i = 0; i < items.length;) {
    const batch = []
    let bytes = 0
    while (i < items.length && batch.length < BATCH && (!batch.length || bytes + items[i].text.length <= BATCH_BYTES)) { bytes += items[i].text.length; batch.push(items[i++]) }
    if (end - Date.now() <= 0) { for (const x of batch) out.set(x.path, late()); continue }
    const got = spawn(batch, end - Date.now())
    if (Array.isArray(got)) { batch.forEach((x, k) => settle(x, got[k])); continue }
    if (batch.length === 1) { out.set(batch[0].path, new Error(got.why)); continue }
    // the batch failed whole (one file crashed the reader, or the batch ran out of time): each file
    // again on its own, so one bad file loses only itself
    for (const x of batch) {
      if (end - Date.now() <= 0) { out.set(x.path, late()); continue }
      const one = spawn([x], end - Date.now())
      if (Array.isArray(one)) settle(x, one[0]); else out.set(x.path, new Error(one.why))
    }
  }
  return out
}

if (process.argv[1] === HERE) {
  const items = JSON.parse(readFileSync(0, 'utf8'))
  const parsers = {}
  let why = null
  try {
    const { loadRuntime } = await import('../../deps.mjs')
    const rt = await loadRuntime({ install: false })
    for (const lang of CODE_LANGS) parsers[lang] = await rt.parserFor(lang)
  } catch (e) { why = `no code reader: ${e.message}` }
  const { CODE } = await import('../registry.mjs')
  const tree = (lang, text) => { if (!parsers[lang]) throw new Error(why || `the pinned ${lang} grammar did not load`); return parsers[lang].parse(text) }
  // a test seam: the reader dies on the file this names, as a grammar's crash would (tests/data.test.mjs)
  const crash = process.env.GRIMOIRE_TEST_ASIDE_CRASH || null
  const out = items.map((x) => {
    if (crash && x.path === crash) process.exit(70)
    const ex = CODE.find((e) => e.id === x.id)
    if (!ex) return { error: `no code extractor ${x.id}` }
    try { return { facts: ex.extract(x.text, x.path, { tree }) } } catch (e) { return { error: String(e.message || e).split('\n')[0].slice(0, 240) } }
  })
  process.stdout.write(JSON.stringify(out))
}
