#!/usr/bin/env node
// grimoire graph · CLI over the same commands as the MCP server.
//   node tools/graph/graph.mjs <command> [value] [--key value …] [--root <project>]
//   commands: status · index [--full] · search <q> · symbol <s> · callers <s> [--depth n] ·
//             callees <s> · impact <target> · file <path> · hierarchy <s> · path <from> <to> · sql <select>
import { TOOLS, call } from './lib/commands.mjs'

const argv = process.argv.slice(2)
const cmd = argv.shift()
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
