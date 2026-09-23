#!/usr/bin/env node
// grimoire graph · CLI over the same commands as the MCP server.
//   node tools/graph/graph.mjs <command> [value] [--key value …] [--root <project>]
//   commands: status · index [--full] · search <q> · symbol <s> · callers <s> [--depth n] ·
//             callees <s> · impact <target> · file <path> · hierarchy <s> · path <from> <to> · sql <select>
//             refresh: what the SubagentStop hook runs. Seeds a worktree from the main checkout,
//             then indexes incrementally; builds the first index only when grimoire.config.json
//             has a `graph` block. Silent no-op when the graph is disabled or was never set up.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { TOOLS, call } from './lib/commands.mjs'
import { loadProject } from './lib/project.mjs'
import { seed } from './lib/freshness.mjs'
import { runIndex } from './lib/run.mjs'

const argv = process.argv.slice(2)
const cmd = argv.shift()
if (cmd === 'refresh') {
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
const tool = cmd && TOOLS.find((t) => t.name === `graph_${cmd}`)
if (!tool) {
  console.log(`usage: graph <command> [value] [--key value]\n\n${TOOLS.map((t) => `  ${t.name.slice(6).padEnd(10)} ${t.description.split('. ')[0]}.`).join('\n')}`)
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
