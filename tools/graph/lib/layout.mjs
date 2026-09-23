// grimoire graph · the map's layout, computed once at render time. Deterministic: the same index
// always gives the same picture (no randomness, no animation in the browser).
//
//   1. files are grouped by directory (repo + up to three levels of their folder); each directory is a circle
//      sized to its files, packed biggest first along a spiral without overlap
//   2. inside its circle, a directory's files start on a sunflower spiral (most connected at the
//      center) and relax for a fixed number of local iterations; cross-directory links are drawn,
//      never pulled on, so directories stay apart and readable
//   3. coordinates are normalized to 0…1000
const ITERATIONS = 260
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export function groupOf(repo, path) {
  const dirs = path.split('/').slice(0, -1)
  return `${repo}:${dirs.length ? dirs.slice(0, 3).join('/') : '.'}`
}

// files: [{ id, repo, path, deg }], links: [[i, j, w]] indexes into files.
export function layoutMap(files, links) {
  const n = files.length
  if (!n) return { pos: [], groups: [] }
  const byGroup = new Map()
  files.forEach((f, i) => { const g = groupOf(f.repo, f.path); (byGroup.get(g) || byGroup.set(g, []).get(g)).push(i) })
  const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  const R = files.map((f) => 3 + Math.min(10, Math.sqrt(f.deg)))

  // 1 · pack the directories: each a circle sized to its files, placed biggest first at the first
  //     point along a spiral where it overlaps no circle already placed. Fixed from here on.
  const gi = new Int32Array(n)
  const circles = []
  for (const [, members] of groups) {
    const area = members.reduce((a, i) => a + (R[i] + 5) ** 2 * 4, 0)
    const r = Math.sqrt(area / Math.PI) + 10
    let x = 0, y = 0
    for (let t = 0; circles.length; t += 0.35) {
      const d = 6 * t
      x = Math.cos(t) * d; y = Math.sin(t) * d
      if (circles.every((c) => (c.x - x) ** 2 + (c.y - y) ** 2 >= (c.r + r + 40) ** 2)) break
    }
    circles.push({ x, y, r })
  }

  // 2 · files inside their circle: a sunflower spiral, most connected at the center, then a fixed
  //     number of local iterations (repulsion within the group, springs along in-group links, a
  //     leash to the circle). Links between directories are drawn, never pulled on.
  const X = new Float64Array(n), Y = new Float64Array(n)
  groups.forEach(([, members], g) => {
    members.sort((a, b) => files[b].deg - files[a].deg || (files[a].path < files[b].path ? -1 : 1))
    const c = circles[g], step = (c.r - 8) / Math.sqrt(Math.max(1, members.length))
    members.forEach((i, k) => { const rr = step * Math.sqrt(k + 0.5); X[i] = c.x + Math.cos(k * GOLDEN) * rr; Y[i] = c.y + Math.sin(k * GOLDEN) * rr; gi[i] = g })
  })
  const inner = links.filter(([a, b]) => gi[a] === gi[b])
  groups.forEach(([, members], g) => {
    if (members.length < 3) return
    const c = circles[g]
    const mine = inner.filter(([a]) => gi[a] === g)
    for (let it = 0; it < ITERATIONS; it++) {
      const alpha = 1 - it / ITERATIONS
      for (let p = 0; p < members.length; p++) for (let q = p + 1; q < members.length; q++) {
        const i = members[p], j = members[q]
        let x = X[i] - X[j], y = Y[i] - Y[j], d2 = x * x + y * y
        const min = R[i] + R[j] + 8
        if (d2 >= min * min * 4) continue
        if (d2 < 0.01) { x = 0.1; y = 0.1 * (p - q); d2 = x * x + y * y }
        const fr = Math.min(2, (min * min) / d2) * 0.06 * alpha
        X[i] += x * fr; Y[i] += y * fr; X[j] -= x * fr; Y[j] -= y * fr
      }
      for (const [a, b] of mine) {
        const x = X[b] - X[a], y = Y[b] - Y[a], d = Math.sqrt(x * x + y * y) || 1
        const fr = ((d - (R[a] + R[b] + 14)) / d) * 0.04 * alpha
        X[a] += x * fr; Y[a] += y * fr; X[b] -= x * fr; Y[b] -= y * fr
      }
      for (const i of members) { // leash: stay inside the circle
        const x = X[i] - c.x, y = Y[i] - c.y, d = Math.sqrt(x * x + y * y), lim = c.r - R[i] - 4
        if (d > lim) { X[i] = c.x + (x / d) * lim; Y[i] = c.y + (y / d) * lim }
      }
    }
  })

  // 3 · normalize to 0…1000 over the circles (so every directory is fully on the page)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const c of circles) { x0 = Math.min(x0, c.x - c.r); y0 = Math.min(y0, c.y - c.r - 30); x1 = Math.max(x1, c.x + c.r); y1 = Math.max(y1, c.y + c.r) }
  const s = 1000 / Math.max(1, x1 - x0, y1 - y0)
  const round = (v) => Math.round(v * 10) / 10
  return {
    pos: files.map((_, i) => [round((X[i] - x0) * s), round((Y[i] - y0) * s)]),
    groups: groups.map(([key, members], g) => ({ key, size: members.length, x: round((circles[g].x - x0) * s), y: round((circles[g].y - y0) * s), r: round(circles[g].r * s) })),
  }
}
