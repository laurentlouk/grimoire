// grimoire graph · change coupling. Files that keep changing in the same commits are related even
// when no import or call links them (a handler and its migration, a client and its schema).
// Read from the last COMMITS non-merge commits; commits touching more than WIDE files (renames,
// formatting sweeps) say nothing and are skipped; a pair needs MIN shared commits to count.
import { spawnSync } from 'node:child_process'

const COMMITS = 400, WIDE = 25, MIN = 2, PER_FILE = 12

export function cochange(db, repo) {
  db.prepare('DELETE FROM cochange WHERE repo = ?').run(repo.name)
  const r = spawnSync('git', ['-C', repo.abs, 'log', `-n${COMMITS}`, '--no-merges', '--name-only', '--relative', '--format=%x00', '--', '.'], { encoding: 'utf8', maxBuffer: 1 << 27 })
  if (r.status !== 0) return
  const indexed = new Set(db.prepare('SELECT path FROM files WHERE repo = ?').all(repo.name).map((f) => f.path))
  const pairs = new Map()
  for (const commit of r.stdout.split('\0')) {
    const files = [...new Set(commit.split('\n').map((s) => s.trim()).filter((f) => indexed.has(f)))]
    if (files.length < 2 || files.length > WIDE) continue
    for (let i = 0; i < files.length; i++) for (let j = 0; j < files.length; j++) {
      if (i === j) continue
      const k = `${files[i]}\0${files[j]}`
      pairs.set(k, (pairs.get(k) || 0) + 1)
    }
  }
  const byA = new Map()
  for (const [k, n] of pairs) {
    if (n < MIN) continue
    const [a, b] = k.split('\0')
    if (!byA.has(a)) byA.set(a, [])
    byA.get(a).push([b, n])
  }
  const ins = db.prepare('INSERT INTO cochange(repo, a, b, n) VALUES(?, ?, ?, ?)')
  for (const [a, list] of byA) for (const [b, n] of list.sort((x, y) => y[1] - x[1]).slice(0, PER_FILE)) ins.run(repo.name, a, b, n)
}
