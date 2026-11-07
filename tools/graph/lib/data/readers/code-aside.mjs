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
// A batch that crashes or runs out of time is each of its files' error.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
export const CODE_LANGS = ['rust', 'typescript', 'tsx']
export const BATCH = 200, BATCH_BYTES = 8 << 20, BATCH_MS = 30_000, TOTAL_MS = 60_000

export function extractAside(items) {
  const out = new Map()
  const end = Date.now() + TOTAL_MS
  for (let i = 0; i < items.length;) {
    const batch = []
    let bytes = 0
    while (i < items.length && batch.length < BATCH && (!batch.length || bytes + items[i].text.length <= BATCH_BYTES)) { bytes += items[i].text.length; batch.push(items[i++]) }
    const left = end - Date.now()
    if (left <= 0) { for (const x of batch) out.set(x.path, new Error(`the time for code at the base (${TOTAL_MS / 1000} s) ran out: not read`)); continue }
    const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', '--stack-size=4000', HERE], { input: JSON.stringify(batch), encoding: 'utf8', maxBuffer: 1 << 28, timeout: Math.min(BATCH_MS, left), killSignal: 'SIGKILL' })
    let got = null
    try { got = JSON.parse(r.stdout) } catch {}
    const why = r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null) ? 'the code took too long to read: not read' : `the code reader stopped (${r.status ?? r.signal}): not read`
    batch.forEach((x, k) => out.set(x.path, got && got[k] ? (got[k].error ? new Error(got[k].error) : got[k].facts) : new Error(why)))
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
  const out = items.map((x) => {
    const ex = CODE.find((e) => e.id === x.id)
    if (!ex) return { error: `no code extractor ${x.id}` }
    try { return { facts: ex.extract(x.text, x.path, { tree }) } } catch (e) { return { error: String(e.message || e).split('\n')[0].slice(0, 240) } }
  })
  process.stdout.write(JSON.stringify(out))
}
