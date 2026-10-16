#!/usr/bin/env node
// grimoire graph · CLI over the same commands as the MCP server.
//   node tools/graph/graph.mjs <command> [value] [--key value …] [--root <project>]
//   commands: status · index [--full] · search <q> · symbol <s> · callers <s> [--depth n] ·
//             callees <s> · impact <target> · file <path> · hierarchy <s> · path <from> <to> · sql <select>
//             render [--out <file>]: refresh, then write the browsable HTML page (default
//             <graph dir>/graph.html) and print its path. Local only: never publish it.
//             refresh: what the SubagentStop hook runs. Seeds a worktree from the main checkout,
//             then indexes incrementally; builds the first index only when grimoire.config.json
//             has a `graph` block. Silent no-op when the graph is disabled or was never set up.
//             serve [--port n]: the same page on http://127.0.0.1, with the Docs tab able to save
//             notes; prints the address (it carries an access token) and runs until stopped.
//             architecture draft [--out <file>] [--title t] [--force]: write a diagram drafted from
//             the graph (default <architectureDir>/system.architecture.json; never overwrites
//             without --force). architecture check [<file>…]: check diagrams against the index
//             (default: every one in the architecture directory); exit 1 on an error.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { TOOLS, call } from './lib/commands.mjs'
import { loadProject } from './lib/project.mjs'
import { seed } from './lib/freshness.mjs'
import { runIndex } from './lib/run.mjs'
import { renderGraph } from './lib/render.mjs'
import { serve } from './lib/serve.mjs'
import { analyze, draftArch, loadIndex, readDiagrams, docRoots, SUFFIX } from './lib/arch.mjs'
import { openStore } from './lib/store.mjs'

const argv = process.argv.slice(2)
const cmd = argv.shift()
if (cmd === 'render') {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null }
  try {
    const project = loadProject(opt('root'))
    if (!project.enabled) { console.error('graph: disabled for this project (grimoire.config.json: graph.enabled = false)'); process.exit(1) }
    await seed(project)
    if (!existsSync(project.dbPath)) { console.error('graph: no index yet; build it first: node tools/graph/graph.mjs index'); process.exit(1) }
    const r = await runIndex(project.root, { onLog: (m) => process.stderr.write(m + '\n') })
    if (r.error) console.error(`graph: refresh failed, rendering the previous index: ${r.error}`)
    const out = path.resolve(opt('out') || path.join(path.dirname(project.dbPath), 'graph.html'))
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, await renderGraph(project))
    console.log(out)
    process.exit(0)
  } catch (e) {
    console.error(`graph render: ${e.message}`)
    process.exit(1)
  }
}
if (cmd === 'serve') {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null }
  try {
    const project = loadProject(opt('root'))
    if (!project.enabled) { console.error('graph: disabled for this project (grimoire.config.json: graph.enabled = false)'); process.exit(1) }
    await seed(project)
    if (!existsSync(project.dbPath)) { console.error('graph: no index yet; build it first: node tools/graph/graph.mjs index'); process.exit(1) }
    const s = await serve(project, { port: Number(opt('port')) || 0, log: (m) => process.stderr.write(`graph serve: ${m}\n`) })
    console.log(s.url)
    console.error('graph serve: local only (127.0.0.1); the address carries its access token. Ctrl-C stops it.')
    const stop = () => s.close().then(() => process.exit(0))
    process.on('SIGINT', stop); process.on('SIGTERM', stop)
    await new Promise(() => {}) // serve until stopped
  } catch (e) {
    console.error(`graph serve: ${e.message}`)
    process.exit(1)
  }
} else if (cmd === 'architecture') {
  const sub = argv.shift()
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null }
  const flags = new Set(['--out', '--title', '--root'])
  const positional = argv.filter((a, i) => !a.startsWith('--') && !flags.has(argv[i - 1]))
  try {
    const project = loadProject(opt('root'))
    if (!project.enabled) { console.error('graph: disabled for this project (grimoire.config.json: graph.enabled = false)'); process.exit(1) }
    await seed(project)
    if (!existsSync(project.dbPath)) { console.error('graph: no index yet; build it first: node tools/graph/graph.mjs index'); process.exit(1) }
    const r = await runIndex(project.root, { onLog: (m) => process.stderr.write(m + '\n') })
    if (r.error) console.error(`graph: refresh failed, using the previous index: ${r.error}`)
    const db = await openStore(project.dbPath, { readOnly: true })
    const idx = loadIndex(db)
    db.close()
    const roots = docRoots(project)
    const report = (file, doc) => {
      const a = analyze(doc, idx, roots)
      console.log(`${file}: ${a.errors.length ? `${a.errors.length} error(s)` : 'passes'}, ${a.warnings.length} warning(s)`)
      for (const e of a.errors) console.log(`  error: ${e}`)
      for (const w of a.warnings) console.log(`  warning: ${w}`)
      for (const i of a.info) console.log(`  ${i}`)
      return a.errors.length
    }
    if (sub === 'draft') {
      const out = path.resolve(opt('out') || path.join(project.architectureDir, `system${SUFFIX}`))
      if (!out.endsWith(SUFFIX)) { console.error(`graph architecture: the file must end in ${SUFFIX}, so the page finds it`); process.exit(1) }
      if (existsSync(out) && !argv.includes('--force')) { console.error(`graph architecture: ${out} exists; refine it, or draft elsewhere with --out (or --force to replace it)`); process.exit(1) }
      if (!idx.files.some((f) => !f.is_test)) { console.error('graph architecture: the index holds no production code to draft from'); process.exit(1) }
      const doc = draftArch(idx, { title: opt('title') || `${path.basename(project.root)} architecture` })
      mkdirSync(path.dirname(out), { recursive: true })
      writeFileSync(out, JSON.stringify(doc, null, 2) + '\n')
      console.log(out)
      report(path.relative(process.cwd(), out) || out, doc)
      process.exit(0)
    }
    if (sub === 'check') {
      const list = positional.length
        ? positional.map((f) => { try { return { file: f, doc: JSON.parse(readFileSync(path.resolve(f), 'utf8')) } } catch (e) { return { file: f, error: e.message } } })
        : readDiagrams(project.architectureDir).map((d) => ({ ...d, file: path.relative(process.cwd(), path.join(project.architectureDir, d.file)) }))
      if (!list.length) { console.log(`no diagram in ${path.relative(process.cwd(), project.architectureDir) || project.architectureDir} yet: graph.mjs architecture draft writes one`); process.exit(0) }
      let errors = 0
      for (const d of list) {
        if (d.error) { console.log(`${d.file}: does not parse: ${d.error}`); errors++; continue }
        errors += report(d.file, d.doc)
      }
      process.exit(errors ? 1 : 0)
    }
    console.error('usage: graph architecture draft [--out <file>] [--title t] [--force] | check [<file>…]')
    process.exit(1)
  } catch (e) {
    console.error(`graph architecture: ${e.message}`)
    process.exit(1)
  }
} else if (cmd === 'refresh') {
  const i = argv.indexOf('--root')
  try {
    const project = loadProject(i >= 0 ? argv[i + 1] : null)
    let configured = false
    try { configured = !!JSON.parse(readFileSync(path.join(project.root, 'grimoire.config.json'), 'utf8')).graph } catch {}
    if (!project.enabled) process.exit(0)
    await seed(project)
    if (!existsSync(project.dbPath) && !configured) process.exit(0)
    const r = await runIndex(project.root, { onLog: (m) => process.stderr.write(m + '\n') })
    console.log(r.error ? `graph refresh failed: ${r.error}` : r.busy ? 'graph refresh: another index is running' : `graph refreshed in ${(r.ms / 1000).toFixed(1)}s`)
    process.exit(r.error ? 1 : 0)
  } catch (e) {
    console.error(`graph refresh: ${e.message}`)
    process.exit(1)
  }
}
const tool = cmd && cmd !== 'serve' && cmd !== 'architecture' && TOOLS.find((t) => t.name === `graph_${cmd}`)
if (!tool) {
  console.log(`usage: graph <command> [value] [--key value]\n\n${TOOLS.map((t) => `  ${t.name.slice(6).padEnd(12)} ${t.description.split('. ')[0]}.`).join('\n')}
  ${'render'.padEnd(12)} Refresh, then write the browsable page and print its path.
  ${'serve'.padEnd(12)} Serve the page on 127.0.0.1, with notes editable in its Docs tab.
  ${'architecture'.padEnd(12)} draft: write a diagram drafted from the graph · check: check diagrams against the index.`)
  process.exit(cmd ? 1 : 0)
}
const args = {}
let root = null
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { positional.push(a); continue }
  const key = a.slice(2)
  const next = argv[i + 1]
  const val = next === undefined || next.startsWith('--') ? true : (i++, next)
  if (key === 'root') root = val
  else args[key] = tool.params[key]?.type === 'integer' ? Number(val) : val
}
for (const [k, v] of (tool.required || Object.keys(tool.params).filter((k) => tool.params[k].type === 'string')).map((k, i) => [k, positional[i]])) if (v !== undefined && args[k] === undefined) args[k] = v
try {
  console.log(await call(tool.name, args, { root, log: (m) => process.stderr.write(m + '\n') }))
} catch (e) {
  console.error(`graph: ${e.message}`)
  process.exit(1)
}
