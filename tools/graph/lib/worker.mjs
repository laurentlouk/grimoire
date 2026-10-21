// grimoire graph · the indexing process. Spawned by run.mjs as
//   node --no-warnings --liftoff-only lib/worker.mjs <root> [--full] [--repo <name>]
// progress on stderr, one JSON summary line on stdout ({ busy: true } when another indexer holds
// the lock: it will pick these changes up, see freshness.mjs).
import path from 'node:path'
import { loadProject } from './project.mjs'
import { indexProject } from './indexer.mjs'
import { withLock, rebase } from './freshness.mjs'

const argv = process.argv.slice(2)
const root = argv[0]
const full = argv.includes('--full')
const only = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : null
try {
  const project = loadProject(root)
  const log = (m) => process.stderr.write(m + '\n')
  // Re-base onto the base checkout's index first when that saves parsing (freshness.mjs); a full
  // rebuild re-parses everything anyway. A failed re-base costs only the saving.
  const summary = await withLock(path.dirname(project.dbPath), async () => {
    if (!full) await rebase(project, { log }).catch((e) => log(`could not re-base: ${e.message}`))
    return indexProject(project, { full, only, log })
  })
  process.stdout.write(JSON.stringify(summary) + '\n')
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n')
  process.exit(1)
}
