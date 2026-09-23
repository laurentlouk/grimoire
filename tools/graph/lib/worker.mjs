// grimoire graph · the indexing process. Spawned by run.mjs as
//   node --no-warnings --liftoff-only lib/worker.mjs <root> [--full] [--repo <name>]
// progress on stderr, one JSON summary line on stdout ({ busy: true } when another indexer holds
// the lock: it will pick these changes up, see freshness.mjs).
import path from 'node:path'
import { loadProject } from './project.mjs'
import { indexProject } from './indexer.mjs'
import { withLock } from './freshness.mjs'

const argv = process.argv.slice(2)
const root = argv[0]
const full = argv.includes('--full')
const only = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : null
try {
  const project = loadProject(root)
  const summary = await withLock(path.dirname(project.dbPath), () => indexProject(project, { full, only, log: (m) => process.stderr.write(m + '\n') }))
  process.stdout.write(JSON.stringify(summary) + '\n')
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n')
  process.exit(1)
}
