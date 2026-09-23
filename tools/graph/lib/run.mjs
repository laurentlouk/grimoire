// grimoire graph · spawning the indexer. It always runs in a child process (see indexer.mjs), so a
// parser crash or a runaway file costs one index run, never the caller.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.mjs')

export function runIndex(root, { full = false, repo = null, timeoutMs = 20 * 60_000, onLog = () => {} } = {}) {
  return new Promise((resolve) => {
    const args = ['--no-warnings', '--liftoff-only', '--stack-size=4000', WORKER, root, ...(full ? ['--full'] : []), ...(repo ? ['--repo', repo] : [])]
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d; for (const l of String(d).split('\n')) if (l.trim()) onLog(l.trim()) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const last = out.trim().split('\n').pop()
      try { const r = JSON.parse(last); if (r.error) return resolve({ error: r.error }); return resolve(r) } catch {}
      resolve({ error: `indexer exited ${code ?? signal}${err ? ': ' + err.trim().split('\n').slice(-3).join(' | ').slice(0, 400) : ''}` })
    })
  })
}
