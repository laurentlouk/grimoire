#!/usr/bin/env node
// grimoire graph · MCP server (stdio, newline-delimited JSON-RPC 2.0, no SDK). Declared in the
// plugin's .mcp.json as server `graph`, so its tools reach agents as mcp__plugin_grimoire_graph__*.
// The project it serves is $GRIMOIRE_PROJECT_DIR, else $CLAUDE_PROJECT_DIR, else the cwd.
import { createInterface } from 'node:readline'
import { TOOLS, call } from './lib/commands.mjs'

const VERSION = '0.1.0'
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
const schema = (t) => ({ type: 'object', properties: t.params, ...(t.required ? { required: t.required } : {}), additionalProperties: false })

async function handle(msg) {
  const { id, method, params = {} } = msg
  switch (method) {
    case 'initialize':
      return send({ id, result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'grimoire-graph', version: VERSION },
        instructions: 'Code graph for RESEARCH: where things are and how they relate (callers, callees, imports, inheritance, blast radius, co-change). Every answer is a lead with path:line; read the code there before stating what it does. Never use it to decide what code does or whether it is correct.',
      } })
    case 'ping': return send({ id, result: {} })
    case 'tools/list': return send({ id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: schema(t) })) } })
    case 'tools/call': {
      try {
        const text = await call(params.name, params.arguments || {}, { log: (m) => process.stderr.write(`[graph] ${m}\n`) })
        return send({ id, result: { content: [{ type: 'text', text }] } })
      } catch (e) {
        return send({ id, result: { content: [{ type: 'text', text: `graph error: ${e.message}` }], isError: true } })
      }
    }
    default:
      if (id !== undefined && id !== null) send({ id, error: { code: -32601, message: `method not found: ${method}` } })
  }
}

// Requests are answered in arrival order, one at a time: the index is a single SQLite file.
let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return send({ id: null, error: { code: -32700, message: 'parse error' } }) }
  queue = queue.then(() => handle(msg)).catch((e) => process.stderr.write(`[graph] ${e.stack}\n`))
})
