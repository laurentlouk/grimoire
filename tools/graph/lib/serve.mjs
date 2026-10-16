// grimoire graph · the page, served locally so its notes can be edited. `graph.mjs serve` starts it.
//
//   GET  /?t=<token>     the page, rendered fresh (the index refreshed first), with saving enabled
//   GET  /api/doc?repo=&path=   a note's text and hash, as on disk now
//   PUT  /api/doc {repo, path, text, base, create?}   write a note; `base` (required unless
//                         creating) is the hash it was loaded with, and a note that changed on disk
//                         since is refused (409, with the disk text); `create` makes a new note (and
//                         its folders), never overwrites. A symlinked note is written through to its
//                         real file, so the link stays; a read-only note is refused.
//
// It listens on the loopback interface only, and every request must name it as its host (a page
// elsewhere cannot rebind a domain to it). Every request carries the token printed at start: in the
// page URL, then as a header the page sets; a cross-origin page can neither read it nor send that
// header without a CORS preflight, which this server never grants. It writes only Markdown notes
// inside the project's repositories (docs.mjs, resolveDoc), each atomically (a temporary file
// renamed over it). Nothing else on disk is reachable through it.
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, unlinkSync, accessSync, constants } from 'node:fs'
import path from 'node:path'
import { renderGraph } from './render.mjs'
import { resolveDoc, docHash } from './docs.mjs'
import { runIndex } from './run.mjs'

const MAX_BODY = 8 * 1024 * 1024

export async function serve(project, { port = 0, log = () => {}, refresh = true } = {}) {
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
        return send(res, 200, await renderGraph(project, { serve: { token } }), 'text/html; charset=utf-8')
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
          const tmp = path.join(path.dirname(r.abs), `.${path.basename(r.abs)}.${process.pid}.${Date.now()}.tmp`)
          try {
            writeFileSync(tmp, body.text, { mode: r.created ? 0o644 : statSync(r.abs).mode & 0o777 })
            renameSync(tmp, r.abs)
          } finally { if (existsSync(tmp)) unlinkSync(tmp) }
          log(`${r.created ? 'created' : 'wrote'} ${path.relative(project.root, r.abs)}`)
          return send(res, r.created ? 201 : 200, { hash: docHash(body.text) })
        }
        return send(res, 405, { error: 'GET or PUT' })
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
