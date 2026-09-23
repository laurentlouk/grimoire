#!/usr/bin/env node
// grimoire · harness manifest. Writes .harness/manifest.json: the plugin version and a sha256 of
// every file that decides what an agent may do. The drift check compares it in CI.
//   Run:  node scripts/harness-manifest.mjs     (or: npm run harness:manifest)
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
export const SURFACE = ['.harness/mcp-policy.json', '.mcp.json', 'hooks/hooks.json', 'hooks/scripts/guard.sh', 'hooks/scripts/guard.mjs', 'hooks/scripts/graph-refresh.sh']
export const sha256 = (file) => createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex')

if (path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname)) {
  const { name, version } = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  const manifest = { schema: 1, name, version, host: 'claude-code', files: Object.fromEntries(SURFACE.map((f) => [f, sha256(f)])) }
  writeFileSync(path.join(ROOT, '.harness/manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`wrote .harness/manifest.json (${SURFACE.length} files)`)
}
