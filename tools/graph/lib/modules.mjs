// grimoire graph · modules, the system map's units. A module is a folder of production code:
// a repository's top-level folders, except that a folder holding more than a third of its repository
// splits into its subfolders (files right in it stay at its level), until no folder dominates. On a typical
// repository that gives tens of modules where the file map has thousands of files.
//
// The system map links two modules when files of one use files of the other: the count is the
// number of distinct file pairs, from links resolved by syntax only (never a name guess) and never
// from test code. Within a repository, modules are ranked by how code flows: a module sits below
// every module that uses it (cycles cut), so entry points come first and shared code last.
// Pure functions: the same index always gives the same map.

const SPLIT_SHARE = 0.35 // a folder above this share of its repository's files splits
const MIN_SPLIT = 5 // … when it has at least this many
const MAX_DEPTH = 4 // folder segments in a module key
const GUESSES = new Set(['ambiguous', 'unique-name'])

const dirsOf = (p) => p.split('/').slice(0, -1)

// fileId → module key, for production files (test code belongs to no module).
export function moduleKeys(files) {
  const keys = new Map()
  const byRepo = new Map()
  for (const f of files) if (!f.is_test) (byRepo.get(f.repo) || byRepo.set(f.repo, []).get(f.repo)).push(f)
  for (const fs of byRepo.values()) {
    const depth = new Map(fs.map((f) => [f.id, dirsOf(f.path).length ? 1 : 0]))
    const keyOf = (f) => { const d = depth.get(f.id); return d ? dirsOf(f.path).slice(0, d).join('/') : '(root)' }
    for (let changed = true; changed;) {
      changed = false
      const groups = new Map()
      for (const f of fs) { const k = keyOf(f); (groups.get(k) || groups.set(k, []).get(k)).push(f) }
      for (const [k, members] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (k === '(root)' || members.length < MIN_SPLIT || members.length <= SPLIT_SHARE * fs.length) continue
        const d = k.split('/').length
        const deeper = members.filter((f) => dirsOf(f.path).length > d)
        if (!deeper.length || d >= MAX_DEPTH) continue
        for (const f of deeper) depth.set(f.id, d + 1)
        changed = true
      }
    }
    for (const f of fs) keys.set(f.id, keyOf(f))
  }
  return keys
}

// files: [{ id, repo, path, is_test, node_id? }], nodes: [{ id, file_id }], edges: [{ src, dst, kind, confidence }]
// → { modules: [{ repo, key, files, rank }], links: [[from, to, filePairs]], fileModule: [[fileId, module]] }
export function systemMap(files, nodes, edges) {
  const keys = moduleKeys(files)
  const fileOfNode = new Map()
  for (const f of files) if (f.node_id !== undefined && f.node_id !== null) fileOfNode.set(f.node_id, f.id)
  for (const n of nodes) fileOfNode.set(n.id, n.file_id)
  const repoOf = new Map(files.map((f) => [f.id, f.repo]))

  const index = new Map(), modules = []
  const sorted = [...keys].map(([id, key]) => ({ id, repo: repoOf.get(id), key })).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (const { id, repo, key } of sorted) {
    const k = `${repo}\0${key}`
    if (!index.has(k)) { index.set(k, modules.length); modules.push({ repo, key, files: 0, rank: 0 }) }
    modules[index.get(k)].files++
  }
  const moduleOf = (fileId) => (keys.has(fileId) ? index.get(`${repoOf.get(fileId)}\0${keys.get(fileId)}`) : undefined)

  const pairs = new Set(), count = new Map()
  for (const e of edges) {
    if (GUESSES.has(e.confidence)) continue
    const fa = fileOfNode.get(e.src), fb = fileOfNode.get(e.dst)
    if (fa === undefined || fb === undefined || fa === fb) continue
    const ma = moduleOf(fa), mb = moduleOf(fb)
    if (ma === undefined || mb === undefined || ma === mb) continue
    const p = `${fa},${fb}`
    if (pairs.has(p)) continue
    pairs.add(p)
    const k = `${ma},${mb}`
    count.set(k, (count.get(k) || 0) + 1)
  }
  const links = [...count].map(([k, n]) => [...k.split(',').map(Number), n]).sort((x, y) => x[0] - y[0] || x[1] - y[1])

  // rank: the longest chain of users above a module, within its repository. Modules in a cycle
  // (strongly connected, Tarjan) share one rank, so a cycle never pushes itself down the lane.
  const out = new Map()
  for (const [a, b] of links) if (a !== b && modules[a].repo === modules[b].repo) (out.get(a) || out.set(a, []).get(a)).push(b)
  const comp = new Array(modules.length).fill(-1), low = [], num = [], stack = [], onStack = new Set()
  let counter = 0, comps = 0
  const strong = (v) => { // iterative Tarjan: no recursion limit on a deep chain
    const work = [[v, 0]]
    num[v] = low[v] = counter++; stack.push(v); onStack.add(v)
    while (work.length) {
      const top = work[work.length - 1], [u, i] = top, next = out.get(u) || []
      if (i < next.length) {
        top[1]++
        const w = next[i]
        if (num[w] === undefined) { num[w] = low[w] = counter++; stack.push(w); onStack.add(w); work.push([w, 0]) }
        else if (onStack.has(w)) low[u] = Math.min(low[u], num[w])
        continue
      }
      work.pop()
      if (work.length) { const parent = work[work.length - 1][0]; low[parent] = Math.min(low[parent], low[u]) }
      if (low[u] === num[u]) { let w; do { w = stack.pop(); onStack.delete(w); comp[w] = comps } while (w !== u); comps++ }
    }
  }
  for (let m = 0; m < modules.length; m++) if (num[m] === undefined) strong(m)
  // Tarjan numbers components in reverse topological order: users get higher numbers. Walk from the
  // highest down, so every user's rank is final before the modules it uses are ranked.
  const compRank = new Array(comps).fill(0)
  const members = new Map()
  for (let m = 0; m < modules.length; m++) (members.get(comp[m]) || members.set(comp[m], []).get(comp[m])).push(m)
  for (let c = comps - 1; c >= 0; c--) for (const m of members.get(c) || []) for (const w of out.get(m) || []) if (comp[w] !== c) compRank[comp[w]] = Math.max(compRank[comp[w]], compRank[c] + 1)
  for (let m = 0; m < modules.length; m++) modules[m].rank = compRank[comp[m]]
  // order within each repository: by rank, then size, then name; links follow the new indexes
  const order = modules.map((m, i) => i).sort((a, b) => {
    const x = modules[a], y = modules[b]
    return (x.repo < y.repo ? -1 : x.repo > y.repo ? 1 : 0) || x.rank - y.rank || y.files - x.files || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)
  })
  const at = new Map(order.map((old, i) => [old, i]))
  return {
    modules: order.map((i) => modules[i]),
    links: links.map(([a, b, n]) => [at.get(a), at.get(b), n]).sort((x, y) => x[0] - y[0] || x[1] - y[1]),
    fileModule: [...keys.keys()].sort((a, b) => a - b).map((id) => [id, at.get(moduleOf(id))]),
  }
}
