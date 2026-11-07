// grimoire graph · the page, served locally so its notes can be edited. `graph.mjs serve` starts it.
//
//   GET  /?t=<token>     the page, rendered fresh (the index refreshed first), with saving enabled
//   GET  /api/doc?repo=&path=   a note's text and hash, as on disk now
//   PUT  /api/doc {repo, path, text, base, create?}   write a note; `base` (required unless
//                         creating) is the hash it was loaded with, and a note that changed on disk
//                         since is refused (409, with the disk text); `create` makes a new note (and
//                         its folders), never overwrites. A symlinked note is written through to its
//                         real file, so the link stays; a read-only note is refused.
//   PUT  /api/delta {repo, path, base, ids, ack}   acknowledge a design delta's changes (ack: true),
//                         or remove their acknowledgement (false): `path` must be
//                         docs/specs/<name>.delta.json in a root (docs.mjs resolveDelta), `base` the
//                         hash it was loaded with (409 with the disk text when it changed since), `ids`
//                         its data changes. The server writes each ack as { by: the git user.name of
//                         that root, else the system user, at: now, hash: the change's hash
//                         (data/delta.mjs) }, never what the request says, and edits only those `ack`
//                         members in the file (setAcks): its layout and every other change stay. A
//                         delta that does not validate is never written (422). The read, the check
//                         and the write run under the delta's lock (data/delta-lock.mjs), the one the
//                         loop's ship step takes to append unplanned changes: neither writes over the
//                         other. Held past its wait: 503, busy, try again; nothing written.
//
// It listens on the loopback interface only, and every request must name it as its host (a page
// elsewhere cannot rebind a domain to it). Every request carries the token printed at start: in the
// page URL, then as a header the page sets; a cross-origin page can neither read it nor send that
// header without a CORS preflight, which this server never grants. It writes only Markdown notes
// inside the project's repositories (docs.mjs, resolveDoc) and the acknowledgements of the deltas
// beside their specs (resolveDelta), each atomically (a temporary file renamed over it). Nothing else
// on disk is reachable through it.
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, unlinkSync, accessSync, constants } from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'
import { renderGraph } from './render.mjs'
import { resolveDoc, resolveDelta, docHash } from './docs.mjs'
import { parseDelta, changeHash, setAcks } from './data/delta.mjs'
import { withDeltaLock } from './data/delta-lock.mjs'
import { runIndex } from './run.mjs'

const MAX_BODY = 8 * 1024 * 1024

// A file replaced through a temporary file beside it, renamed over it (never half-written).
function writeAtomic(abs, text, mode) {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`)
  try {
    writeFileSync(tmp, text, { mode })
    renameSync(tmp, abs)
  } finally { if (existsSync(tmp)) unlinkSync(tmp) }
}
// Who acknowledges: the git user.name the root sees (its own config, else the global one), else the
// system user; on one line (control characters as blanks), 120 characters at most: a repository's
// own .git/config is not to be trusted with what the delta holds.
const oneLine = (s, max) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
function whoAcks(dir) {
  const r = spawnSync('git', ['-C', dir, 'config', 'user.name'], { encoding: 'utf8', timeout: 5000 })
  const name = r.status === 0 ? oneLine(r.stdout, 120) : ''
  if (name) return name
  try { return oneLine(userInfo().username, 120) || 'unknown' } catch { return 'unknown' }
}

// opts.delta: the delta the Data tab shows first (graph.mjs serve --delta), as render.mjs takes it;
// opts.deltaLock: the delta lock's { waitMs, staleMs } (data/delta-lock.mjs defaults; tests shorten them)
export async function serve(project, { port = 0, log = () => {}, refresh = true, delta = null, deltaLock = {} } = {}) {
  const token = randomBytes(24).toString('base64url')
  const tok = Buffer.from(token)
  const same = (v) => { const b = Buffer.from(String(v || '')); return b.length === tok.length && timingSafeEqual(b, tok) }
  let actual = port
  const hosts = () => new Set([`127.0.0.1:${actual}`, `localhost:${actual}`])
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

  const server = http.createServer(async (req, res) => {
    try {
      if (!hosts().has(req.headers.host || '')) return send(res, 403, { error: 'wrong host' })
      const origin = req.headers.origin
      if (origin && !hosts().has(origin.replace(/^http:\/\//, ''))) return send(res, 403, { error: 'cross-origin request refused' })
      const url = new URL(req.url, `http://${req.headers.host}`)
      if (url.pathname === '/' && req.method === 'GET') {
        if (!same(url.searchParams.get('t'))) return send(res, 403, 'Open the address `graph.mjs serve` printed (it carries the access token).', 'text/plain; charset=utf-8')
        if (refresh) { const r = await runIndex(project.root, { onLog: log }); if (r.error) log(`refresh failed, serving the previous index: ${r.error}`) }
        return send(res, 200, await renderGraph(project, { serve: { token }, delta }), 'text/html; charset=utf-8')
      }
      if (url.pathname === '/api/doc') {
        if (!same(req.headers['x-grimoire-token'])) return send(res, 403, { error: 'missing or wrong token' })
        if (req.method === 'GET') {
          const r = resolveDoc(project, url.searchParams.get('repo'), url.searchParams.get('path'))
          if (r.error) return send(res, 404, { error: r.error })
          if (statSync(r.abs).size > project.maxBytes) return send(res, 413, { error: 'too large to edit here' })
          const text = readFileSync(r.abs, 'utf8')
          return send(res, 200, { text, hash: docHash(text) })
        }
        if (req.method === 'PUT') {
          if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' })
          let body
          try { body = JSON.parse(await readBody(req)) } catch (e) { return send(res, 400, { error: `bad body: ${e.message}` }) }
          if (!body || typeof body.text !== 'string') return send(res, 400, { error: 'text is required' })
          const r = resolveDoc(project, body.repo, body.path, { create: !!body.create })
          if (r.error) return send(res, 400, { error: r.error })
          if (body.create && !r.created) return send(res, 409, { error: 'that note exists already' })
          if (!r.created) {
            if (typeof body.base !== 'string' || !body.base) return send(res, 400, { error: 'base (the hash the note was loaded with) is required' })
            try { accessSync(r.abs, constants.W_OK) } catch { return send(res, 403, { error: 'the note is read-only' }) }
            const disk = readFileSync(r.abs, 'utf8')
            if (docHash(disk) !== body.base) return send(res, 409, { error: 'changed on disk since it was loaded', text: disk, hash: docHash(disk) })
          }
          if (r.created) mkdirSync(path.dirname(r.abs), { recursive: true })
          writeAtomic(r.abs, body.text, r.created ? 0o644 : statSync(r.abs).mode & 0o777)
          log(`${r.created ? 'created' : 'wrote'} ${path.relative(project.root, r.abs)}`)
          return send(res, r.created ? 201 : 200, { hash: docHash(body.text) })
        }
        return send(res, 405, { error: 'GET or PUT' })
      }
      if (url.pathname === '/api/delta') {
        if (!same(req.headers['x-grimoire-token'])) return send(res, 403, { error: 'missing or wrong token' })
        if (req.method !== 'PUT') return send(res, 405, { error: 'PUT' })
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' })
        let body
        try { body = JSON.parse(await readBody(req)) } catch (e) { return send(res, 400, { error: `bad body: ${e.message}` }) }
        if (!body || typeof body !== 'object') return send(res, 400, { error: 'a JSON object: { repo, path, base, ids, ack }' })
        if (typeof body.base !== 'string' || !body.base) return send(res, 400, { error: 'base (the hash the delta was loaded with) is required' })
        if (!Array.isArray(body.ids) || !body.ids.length || !body.ids.every((x) => typeof x === 'string')) return send(res, 400, { error: 'ids: the changes to acknowledge, by their id' })
        if (typeof body.ack !== 'boolean') return send(res, 400, { error: 'ack: true to acknowledge, false to remove the acknowledgement' })
        const r = resolveDelta(project, body.repo, body.path)
        if (r.error) return send(res, 400, { error: r.error })
        try { accessSync(r.abs, constants.W_OK) } catch { return send(res, 403, { error: 'the delta is read-only' }) }
        if (statSync(r.abs).size > project.maxBytes) return send(res, 413, { error: 'too large to write here' })
        const by = whoAcks(r.root.abs) // before the lock: a git call, not the file's business
        const done = await withDeltaLock(r.abs, () => {
          const disk = readFileSync(r.abs, 'utf8')
          if (docHash(disk) !== body.base) return [409, { error: 'changed on disk since it was loaded', text: disk, hash: docHash(disk) }]
          const { delta: doc, errors } = parseDelta(disk)
          if (errors.length) return [422, { error: `the delta does not validate: ${errors.join('; ')}` }]
          const at = new Map(doc.data.map((c, i) => [c.id, i]))
          const missing = [...new Set(body.ids)].filter((id) => !at.has(id))
          if (missing.length) return [400, { error: `no data change with the id ${missing.map((x) => JSON.stringify(x)).join(', ')}` }]
          const when = new Date().toISOString()
          const edits = new Map(body.ids.map((id) => [at.get(id), body.ack ? { by, at: when, hash: changeHash(doc.data[at.get(id)]) } : null]))
          const text = setAcks(disk, edits)
          writeAtomic(r.abs, text, statSync(r.abs).mode & 0o777)
          log(`${body.ack ? 'acknowledged' : 'removed the acknowledgement of'} ${body.ids.slice(0, 20).map((x) => JSON.stringify(x.slice(0, 80))).join(', ')}${body.ids.length > 20 ? ` and ${body.ids.length - 20} more` : ''} in ${JSON.stringify(path.relative(project.root, r.abs)).slice(1, -1)}`)
          return [200, { hash: docHash(text), changes: [...new Set(body.ids)].map((id) => ({ id, ack: edits.get(at.get(id)) })) }]
        }, deltaLock)
        if (done.busy) return send(res, 503, { error: 'busy: another writer has the delta (the loop recording a change); try again in a moment' })
        return send(res, ...done.value)
      }
      return send(res, 404, { error: 'not found' })
    } catch (e) {
      log(`error: ${e.message}`)
      return send(res, 500, { error: 'the server failed; its terminal says why' })
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  actual = server.address().port
  return { url: `http://127.0.0.1:${actual}/?t=${token}`, port: actual, token, close: () => new Promise((r) => server.close(r)) }
}
