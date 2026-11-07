// grimoire graph · data · YAML parsed in a process of its own, for what reads YAML outside the
// indexer's process: the model at a base ref (data/base.mjs) is built where graph_changes and the
// page run, the MCP server's process, so its YAML is parsed here, with the indexer's flags (V8's
// Liftoff-only WASM tier, lib/run.mjs): a grammar's crash costs this process, never the server.
//
//   parseAside(texts, { timeout }) → Map(text → [document] | Error)   (readers/yaml.mjs documents)
//   node --liftoff-only yaml-aside.mjs  < JSON [text]  → JSON [{ docs: [{ value, lines: [[key, line]],
//   line }] } | { error }]   (the child; the runtime is used as installed, never installed from here)
//
// Bounded, each text failing alone: a text past yaml.mjs YAML_MAX is refused without a process; each
// other text is parsed in a process of its own, killed past its timeout (TEXT_MS, plus SCALE_MS per
// MB; `timeout(text) → ms` overrides it), and all of them share TOTAL_MS, past which the texts left
// are not parsed. A timeout, a crash or a budget spent is that text's error.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { YAML_MAX } from './yaml.mjs'

const HERE = fileURLToPath(import.meta.url)
export const TEXT_MS = 5_000, SCALE_MS = 10_000, TOTAL_MS = 30_000

export function parseAside(texts, { timeout = (t) => TEXT_MS + Math.round((SCALE_MS * t.length) / (1 << 20)) } = {}) {
  const out = new Map()
  const end = Date.now() + TOTAL_MS
  for (const t of new Set(texts)) {
    if (t.length > YAML_MAX) { out.set(t, new Error(`the YAML is larger than ${YAML_MAX >> 10} KB: not read`)); continue }
    const left = end - Date.now()
    if (left <= 0) { out.set(t, new Error(`the time for YAML at the base (${TOTAL_MS / 1000} s) ran out: not read`)); continue }
    const ms = Math.max(1, Math.min(timeout(t), left))
    const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', '--stack-size=4000', HERE], { input: JSON.stringify([t]), encoding: 'utf8', maxBuffer: 1 << 28, timeout: ms, killSignal: 'SIGKILL' })
    if (r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null)) { out.set(t, new Error(`the YAML took longer than ${ms} ms to read: not read`)); continue }
    let got = null
    try { got = JSON.parse(r.stdout)[0] } catch {}
    out.set(t, got && Array.isArray(got.docs) ? got.docs.map((d) => ({ value: d.value, lines: new Map(d.lines), line: d.line })) : new Error(got?.error || `the YAML reader stopped (${r.status ?? r.signal}): not read`))
  }
  return out
}

if (process.argv[1] === HERE) {
  const texts = JSON.parse(readFileSync(0, 'utf8'))
  let parser = null, why = null
  try {
    const { loadRuntime } = await import('../../deps.mjs')
    parser = await (await loadRuntime({ install: false })).parserFor('yaml')
    if (!parser) why = 'the pinned YAML grammar did not load'
  } catch (e) { why = `no YAML reader: ${e.message}` }
  const { readYaml } = await import('./yaml.mjs')
  const out = texts.map((t) => {
    if (!parser) return { error: why }
    try { return { docs: readYaml(parser, t).map((d) => ({ value: d.value, lines: [...d.lines], line: d.line })) } } catch (e) { return { error: String(e.message || e).split('\n')[0] } }
  })
  process.stdout.write(JSON.stringify(out))
}
