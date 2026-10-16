// grimoire graph · architecture diagrams. A diagram is a typed JSON file (docs/architecture/
// <name>.architecture.json, the graph.architectureDir setting moves it): components with a type,
// boundaries around them, labelled connections, and cards for what a line cannot say. archify was
// the example; the format is grimoire's own, shaped by what the code graph can check, and evolves
// with it (no dependency, no compatibility promise). Two hands write it:
//   draft   the script, deterministically: one component per module of the system map
//           (modules.mjs), typed by its folder names and the frameworks it imports, plus the
//           external services its imports name (KNOWN), linked by the file pairs that use each
//           other through links resolved by syntax. Every name and type in a draft is a guess.
//   refine  an agent (/grimoire:architecture), reading the code: names by responsibility, merges
//           and splits, adds what the index cannot see (a datastore behind config, a queue, a
//           trust boundary), labels what flows, cites path:line for each component.
// The graph then checks the refined diagram (analyze): every `paths` glob must match indexed
// files, every source must exist with its lines, and each connection between two code components
// is counted against the index, so a drawn line the code does not show, and a code link no line
// shows, are both reported. The page draws the result (render.mjs, Architecture tab).
// Pure apart from checkSources (reads the files a source names) and the loaders at the bottom.
import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { systemMap } from './modules.mjs'
import { docRoots } from './docs.mjs'

export const TYPES = ['frontend', 'backend', 'worker', 'database', 'messagebus', 'cloud', 'security', 'external', 'library', 'cli']
export const VARIANTS = ['default', 'emphasis', 'security', 'async', 'dashed']
export const BOUNDARY_KINDS = ['repo', 'deploy', 'trust', 'region', 'network', 'group']
export const CARD_COLORS = ['cyan', 'emerald', 'violet', 'amber', 'rose', 'orange', 'slate']
export const SUFFIX = '.architecture.json'
const GUESSES = new Set(['ambiguous', 'unique-name'])
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

// External services an import names. `imports` are package prefixes (see importMatches).
export const KNOWN = [
  { id: 'postgres', label: 'PostgreSQL', type: 'database', via: 'SQL', imports: ['pg', 'postgres', 'pg-promise', 'psycopg', 'psycopg2', 'asyncpg', 'github.com/lib/pq', 'github.com/jackc/pgx', '@neondatabase/serverless', '@vercel/postgres', 'org.postgresql'] },
  { id: 'mysql', label: 'MySQL', type: 'database', via: 'SQL', imports: ['mysql', 'mysql2', 'pymysql', 'MySQLdb', 'github.com/go-sql-driver/mysql'] },
  { id: 'sqlite', label: 'SQLite', type: 'database', via: 'SQL', imports: ['sqlite3', 'better-sqlite3', 'node:sqlite', 'sqlite', 'rusqlite', 'github.com/mattn/go-sqlite3'] },
  { id: 'sql-db', label: 'SQL database', sublabel: 'through an ORM', type: 'database', via: 'ORM', imports: ['@prisma/client', 'typeorm', 'sequelize', 'knex', 'drizzle-orm', 'sqlalchemy', 'django.db', 'gorm.io/gorm', 'diesel', 'sqlx', 'sea_orm', 'org.hibernate', 'jakarta.persistence', 'javax.persistence', 'peewee', 'tortoise'] },
  { id: 'mongodb', label: 'MongoDB', type: 'database', via: 'queries', imports: ['mongodb', 'mongoose', 'pymongo', 'motor', 'go.mongodb.org/mongo-driver'] },
  { id: 'redis', label: 'Redis', type: 'database', via: 'cache', imports: ['redis', 'ioredis', '@redis/client', '@upstash/redis', 'aioredis', 'github.com/redis/go-redis', 'github.com/go-redis/redis'] },
  { id: 'search', label: 'Search engine', type: 'database', via: 'search', imports: ['@elastic/elasticsearch', 'elasticsearch', 'opensearchpy', '@opensearch-project/opensearch', 'meilisearch', 'algoliasearch', 'typesense'] },
  { id: 'kafka', label: 'Kafka', type: 'messagebus', via: 'events', imports: ['kafkajs', '@confluentinc/kafka-javascript', 'confluent_kafka', 'kafka', 'aiokafka', 'github.com/segmentio/kafka-go', 'github.com/IBM/sarama', 'github.com/Shopify/sarama', 'rdkafka', 'org.apache.kafka'] },
  { id: 'rabbitmq', label: 'RabbitMQ', type: 'messagebus', via: 'messages', imports: ['amqplib', 'amqp-connection-manager', 'pika', 'aio_pika', 'lapin', 'github.com/rabbitmq/amqp091-go'] },
  { id: 'nats', label: 'NATS', type: 'messagebus', via: 'messages', imports: ['nats', 'github.com/nats-io/nats.go'] },
  { id: 'job-queue', label: 'Job queue', type: 'messagebus', via: 'jobs', imports: ['bullmq', 'bull', 'bee-queue', 'celery', 'rq', 'dramatiq', 'github.com/hibiken/asynq'] },
  { id: 'aws', label: 'AWS', type: 'cloud', via: 'SDK', imports: ['@aws-sdk', 'aws-sdk', 'boto3', 'botocore', 'aioboto3', 'github.com/aws/aws-sdk-go', 'github.com/aws/aws-sdk-go-v2', 'aws_sdk_s3', 'aws_config', 'software.amazon.awssdk'] },
  { id: 'gcp', label: 'Google Cloud', type: 'cloud', via: 'SDK', imports: ['@google-cloud', 'google.cloud', 'cloud.google.com/go'] },
  { id: 'azure', label: 'Azure', type: 'cloud', via: 'SDK', imports: ['@azure', 'azure'] },
  { id: 'firebase', label: 'Firebase', type: 'cloud', via: 'SDK', imports: ['firebase', 'firebase-admin', '@firebase'] },
  { id: 'supabase', label: 'Supabase', type: 'cloud', via: 'SDK', imports: ['@supabase', 'supabase'] },
  { id: 'stripe', label: 'Stripe', type: 'external', via: 'payments API', imports: ['stripe', '@stripe/stripe-js', 'github.com/stripe/stripe-go'] },
  { id: 'llm', label: 'LLM API', type: 'external', via: 'API', imports: ['openai', '@anthropic-ai/sdk', 'anthropic', '@google/generative-ai', '@google/genai', 'cohere', '@mistralai/mistralai', 'ollama', '@ai-sdk', '@langchain', 'langchain'] },
  { id: 'github-api', label: 'GitHub API', type: 'external', via: 'API', imports: ['@octokit', 'octokit', 'github.com/google/go-github', 'PyGithub'] },
  { id: 'slack', label: 'Slack', type: 'external', via: 'API', imports: ['@slack', 'slack_sdk', 'slack_bolt'] },
  { id: 'email', label: 'Email / SMS', type: 'external', via: 'API', imports: ['nodemailer', '@sendgrid/mail', 'resend', 'postmark', 'twilio', 'mailgun.js', 'sendgrid'] },
  { id: 'telemetry', label: 'Telemetry', sublabel: 'errors, traces, analytics', type: 'external', via: 'telemetry', imports: ['@sentry', 'sentry_sdk', 'sentry-go', 'posthog', 'posthog-node', 'posthog-js', '@opentelemetry', 'opentelemetry', 'dd-trace', '@datadog', 'newrelic'] },
  { id: 'auth-provider', label: 'Auth provider', type: 'security', via: 'OAuth / OIDC', imports: ['@auth0', 'auth0', '@clerk', '@okta', 'next-auth', '@auth/core', 'passport', 'authlib', 'python-keycloak', 'keycloak-js'] },
]
// Frameworks that say what a module is, by its imports.
const HINTS = [
  ['frontend', ['react', 'react-dom', 'vue', 'svelte', 'next', '@angular/core', 'solid-js', 'preact', 'react-native', 'expo', 'SwiftUI', 'UIKit', 'androidx', 'package:flutter', 'nuxt', 'astro', '@remix-run/react']],
  ['backend', ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@nestjs/common', 'flask', 'fastapi', 'django', 'starlette', 'aiohttp', 'github.com/gin-gonic/gin', 'github.com/labstack/echo', 'github.com/gofiber/fiber', 'actix_web', 'axum', 'rocket', 'org.springframework', 'sinatra', 'Illuminate', '@modelcontextprotocol/sdk', 'node:http', 'http.server']],
  ['cli', ['commander', 'yargs', 'clap', 'github.com/spf13/cobra', 'click', 'typer', 'argparse', '@oclif/core']],
]
// Folder names that say what a module is. First match wins; frameworks win over folders.
const FOLDERS = [
  ['cloud', /(^|\/)(infra|infrastructure|terraform|deploy|deployment|deployments|k8s|kubernetes|helm|charts|cdk|pulumi|ops|docker)(\/|$)/i],
  ['database', /(^|\/)(db|database|databases|migrations?|models?|schemas?|stores?|storage|repositor(y|ies)|dao|persistence|sql|entities)(\/|$)/i],
  ['messagebus', /(^|\/)(queues?|events?|bus|kafka|pubsub|messaging|broker|streams?|topics?)(\/|$)/i],
  ['worker', /(^|\/)(workers?|jobs?|tasks?|cron|scheduler|consumers?|background)(\/|$)/i],
  ['security', /(^|\/)(auth|authn|authz|security|iam|permissions?|crypto|sessions?|identity)(\/|$)/i],
  ['frontend', /(^|\/)(web|ui|client|clients|frontend|front|components|pages|views|screens|www|public|ios|android|mobile)(\/|$)/i],
  ['backend', /(^|\/)(api|apis|server|servers|routes?|handlers?|controllers?|services?|graphql|rpc|grpc|endpoints?|backend|mcp)(\/|$)/i],
  ['cli', /(^|\/)(cli|cmd|bin|scripts?|tools?|commands?)(\/|$)/i],
]
const FRONT_LANGS = new Set(['tsx', 'jsx', 'vue', 'svelte', 'swift', 'dart'])

// An import source matches a package prefix: `pg` matches pg, pg/lib, pg.pool, pg::x; `x*` any prefix.
export function importMatches(source, pattern) {
  if (!source || !pattern) return false
  if (pattern.endsWith('*')) return source.startsWith(pattern.slice(0, -1))
  // a dotted submodule (sqlalchemy.orm, org.apache.kafka.clients) never holds a slash: github.com/x is not github
  return source === pattern || source.startsWith(pattern + '/') || source.startsWith(pattern + '::') || (source.startsWith(pattern + '.') && !source.slice(pattern.length + 1).includes('/'))
}

export function guessType(key, langs, sources) {
  for (const [type, pkgs] of HINTS) if (sources.some((s) => pkgs.some((p) => importMatches(s, p)))) return type
  for (const [type, re] of FOLDERS) if (re.test(key)) return type
  if (langs.some((l) => FRONT_LANGS.has(l))) return 'frontend'
  if (langs.includes('hcl')) return 'cloud'
  return 'library'
}

// A component's path pattern: `src/api` is that folder (or file) and everything under it; with a
// wildcard it must match the whole path: `*` within a segment, `**` across segments (`src/*` is the
// files right in src/, `src/**/*.sql` every .sql file below it).
export function globRe(pat) {
  const p = pat.replace(/^\.\//, '').replace(/\/+$/, '')
  const lit = (x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  if (!p.includes('*')) return new RegExp(`^${lit(p)}(/|$)`)
  return new RegExp(`^${lit(p).replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`)
}

const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'x'

// ── structure ──────────────────────────────────────────────────────────────────────────────
// Problems with the JSON itself: { errors, warnings }, each a string naming where.
export function validate(doc) {
  const errors = [], warnings = []
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { errors: ['the file is not a JSON object'], warnings }
  if (doc.schema !== 1) errors.push('schema: must be 1')
  if (typeof doc.title !== 'string' || !doc.title.trim()) errors.push('title: required')
  if (!Array.isArray(doc.components) || !doc.components.length) errors.push('components: at least one')
  const ids = new Set(), cells = new Map()
  for (const [k, c] of (Array.isArray(doc.components) ? doc.components : []).entries()) {
    const at = `components[${k}]${c && c.id ? ` (${c.id})` : ''}`
    if (!c || typeof c !== 'object') { errors.push(`${at}: not an object`); continue }
    if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push(`${at}: id must match ${ID} (lower case, digits, . _ -)`)
    else if (ids.has(c.id)) errors.push(`${at}: duplicate id`)
    else ids.add(c.id)
    if (typeof c.label !== 'string' || !c.label.trim()) errors.push(`${at}: label required`)
    if (!TYPES.includes(c.type)) errors.push(`${at}: type must be one of ${TYPES.join(', ')}`)
    for (const f of ['paths', 'imports', 'sources']) if (c[f] !== undefined && (!Array.isArray(c[f]) || c[f].some((x) => typeof x !== 'string' || !x))) errors.push(`${at}: ${f} must be a list of strings`)
    for (const f of ['sublabel', 'note', 'tag', 'repo']) if (c[f] !== undefined && typeof c[f] !== 'string') errors.push(`${at}: ${f} must be a string`)
    const hasCol = c.col !== undefined, hasRow = c.row !== undefined
    if (hasCol !== hasRow) errors.push(`${at}: give col and row together`)
    if (hasCol && hasRow) {
      if (!Number.isInteger(c.col) || !Number.isInteger(c.row) || c.col < 0 || c.row < 0 || c.col > 40 || c.row > 80) errors.push(`${at}: col and row are whole numbers, 0–40 and 0–80`)
      else { const cell = `${c.col},${c.row}`; if (cells.has(cell)) errors.push(`${at}: shares cell col ${c.col}, row ${c.row} with ${cells.get(cell)}`); else cells.set(cell, c.id) }
    }
  }
  const seen = new Set()
  for (const [k, e] of (Array.isArray(doc.connections) ? doc.connections : []).entries()) {
    const at = `connections[${k}]${e && e.from ? ` (${e.from} → ${e.to})` : ''}`
    if (!e || typeof e !== 'object') { errors.push(`${at}: not an object`); continue }
    if (!ids.has(e.from)) errors.push(`${at}: from names no component`)
    if (!ids.has(e.to)) errors.push(`${at}: to names no component`)
    if (e.from === e.to) errors.push(`${at}: a component does not connect to itself`)
    if (e.variant !== undefined && !VARIANTS.includes(e.variant)) errors.push(`${at}: variant must be one of ${VARIANTS.join(', ')}`)
    for (const f of ['label', 'via', 'note']) if (e[f] !== undefined && typeof e[f] !== 'string') errors.push(`${at}: ${f} must be a string`)
    const key = `${e.from}>${e.to}`
    if (seen.has(key)) warnings.push(`${at}: drawn twice; one line per direction reads better (put both labels in one)`)
    seen.add(key)
  }
  if (doc.connections !== undefined && !Array.isArray(doc.connections)) errors.push('connections: must be a list')
  for (const [k, b] of (Array.isArray(doc.boundaries) ? doc.boundaries : []).entries()) {
    const at = `boundaries[${k}]${b && b.label ? ` (${b.label})` : ''}`
    if (!b || typeof b !== 'object') { errors.push(`${at}: not an object`); continue }
    if (typeof b.label !== 'string' || !b.label.trim()) errors.push(`${at}: label required`)
    if (b.kind !== undefined && !BOUNDARY_KINDS.includes(b.kind)) errors.push(`${at}: kind must be one of ${BOUNDARY_KINDS.join(', ')}`)
    if (!Array.isArray(b.wraps) || !b.wraps.length) errors.push(`${at}: wraps at least one component`)
    else for (const w of b.wraps) if (!ids.has(w)) errors.push(`${at}: wraps ${JSON.stringify(w)}, which is no component`)
  }
  for (const [k, c] of (Array.isArray(doc.cards) ? doc.cards : []).entries()) {
    if (!c || typeof c.title !== 'string' || !Array.isArray(c.items) || c.items.some((x) => typeof x !== 'string')) errors.push(`cards[${k}]: needs a title and a list of item strings`)
    else if (c.color !== undefined && !CARD_COLORS.includes(c.color)) errors.push(`cards[${k}]: color must be one of ${CARD_COLORS.join(', ')}`)
  }
  return { errors, warnings }
}

// 'api:src/app.ts:10-20' | 'src/app.ts:10' | 'README.md' → { repo?, path, start?, end? }
export function parseSource(s, repoNames) {
  let rest = String(s).trim(), repo
  const pre = /^([^:/\s]+):(.+)$/.exec(rest)
  if (pre && repoNames.includes(pre[1])) { repo = pre[1]; rest = pre[2] } // a leading name that is no repository is part of the path
  const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(rest)
  if (!m) return null
  const [, p, a, b] = m
  return { ...(repo ? { repo } : {}), path: p, start: a ? Number(a) : undefined, end: b ? Number(b) : a ? Number(a) : undefined }
}

// ── against the index ──────────────────────────────────────────────────────────────────────
// idx: { repos: [names], files: [{ id, repo, path, is_test, node_id }], nodes: [{ id, file_id }],
//        edges: [{ src, dst, kind, confidence }], imports: [{ file_id, source }] }
// → { members: [[fileId…] per component], unmatched: [[pattern…]], evidence: [n per connection],
//     reverse: [n per connection], ghosts: [[from, to, n]], coverage: { covered, total, uncovered: [[module, files]] },
//     overlap: [[fileShown, [componentIds]]] }
export function bindCode(doc, idx) {
  const comps = doc.components || [], conns = doc.connections || []
  const single = idx.repos.length === 1 ? idx.repos[0] : null
  const prod = idx.files.filter((f) => !f.is_test)
  const members = [], unmatched = []
  const compsOf = new Map() // fileId → [component index]
  comps.forEach((c, ci) => {
    const ids = [], miss = []
    for (const raw of c.paths || []) {
      let repo = c.repo || single, pat = raw
      const m = /^([^:/*]+):(.+)$/.exec(raw)
      if (m && idx.repos.includes(m[1])) { repo = m[1]; pat = m[2] }
      const re = globRe(pat)
      const hit = prod.filter((f) => (!repo || f.repo === repo) && re.test(f.path))
      if (!hit.length) miss.push(raw)
      for (const f of hit) ids.push(f.id)
    }
    const uniq = [...new Set(ids)]
    members.push(uniq)
    unmatched.push(miss)
    for (const id of uniq) (compsOf.get(id) || compsOf.set(id, []).get(id)).push(ci)
  })
  const fileOfNode = new Map()
  for (const f of idx.files) fileOfNode.set(f.node_id, f.id)
  for (const n of idx.nodes) fileOfNode.set(n.id, n.file_id)
  const testFile = new Set(idx.files.filter((f) => f.is_test).map((f) => f.id))
  const count = new Map(), pairs = new Set()
  const bump = (a, b) => { const k = `${a}>${b}`; count.set(k, (count.get(k) || 0) + 1) }
  for (const e of idx.edges) {
    if (GUESSES.has(e.confidence)) continue
    const fa = fileOfNode.get(e.src), fb = fileOfNode.get(e.dst)
    if (fa === undefined || fb === undefined || fa === fb || testFile.has(fa) || testFile.has(fb)) continue
    const p = `${fa},${fb}`
    if (pairs.has(p)) continue
    pairs.add(p)
    for (const a of compsOf.get(fa) || []) for (const b of compsOf.get(fb) || []) if (a !== b) bump(a, b)
  }
  // a component with `imports` is reached by every file that imports one of them
  const importers = comps.map(() => new Set())
  comps.forEach((c, ci) => {
    if (!c.imports || !c.imports.length) return
    for (const im of idx.imports) if (!testFile.has(im.file_id) && c.imports.some((p) => importMatches(im.source, p))) importers[ci].add(im.file_id)
  })
  comps.forEach((c, b) => { for (const fa of importers[b]) for (const a of compsOf.get(fa) || []) if (a !== b) { const k = `${a}>${b}`; if (!pairs.has(`${fa}>${b}`)) { pairs.add(`${fa}>${b}`); count.set(k, (count.get(k) || 0) + 1) } } })
  const at = new Map(comps.map((c, i) => [c.id, i]))
  const declared = new Set(conns.map((e) => `${at.get(e.from)}>${at.get(e.to)}`))
  const evidence = conns.map((e) => count.get(`${at.get(e.from)}>${at.get(e.to)}`) || 0)
  const reverse = conns.map((e) => count.get(`${at.get(e.to)}>${at.get(e.from)}`) || 0)
  const ghosts = []
  for (const [k, n] of count) { const [a, b] = k.split('>').map(Number); if (!declared.has(k) && !declared.has(`${b}>${a}`)) ghosts.push([comps[a].id, comps[b].id, n]) }
  ghosts.sort((x, y) => y[2] - x[2] || (x[0] < y[0] ? -1 : 1))
  // coverage: production files of the repositories the diagram draws code from
  const repos = new Set(prod.filter((f) => compsOf.has(f.id)).map((f) => f.repo))
  const inScope = prod.filter((f) => repos.has(f.repo))
  const uncoveredBy = new Map()
  for (const f of inScope) if (!compsOf.has(f.id)) { const d = f.path.includes('/') ? f.path.split('/').slice(0, 2).join('/').replace(/\/[^/]*\.[^/]*$/, '') : '(root)'; const k = idx.repos.length > 1 ? `${f.repo}:${d}` : d; uncoveredBy.set(k, (uncoveredBy.get(k) || 0) + 1) }
  const shown = new Map(idx.files.map((f) => [f.id, idx.repos.length > 1 ? `${f.repo}:${f.path}` : f.path]))
  const overlap = [...compsOf].filter(([, cs]) => cs.length > 1).slice(0, 20).map(([id, cs]) => [shown.get(id), cs.map((c) => comps[c].id)])
  return {
    members, unmatched, evidence, reverse, ghosts,
    coverage: { covered: inScope.length - [...uncoveredBy.values()].reduce((a, b) => a + b, 0), total: inScope.length, uncovered: [...uncoveredBy].sort((a, b) => b[1] - a[1]) },
    overlap,
  }
}

// Sources must name files that exist, with the lines they cite. roots: docRoots(project).
export function checkSources(doc, roots) {
  const problems = []
  const names = roots.map((r) => r.name)
  const single = roots.length === 1 ? roots[0] : roots.find((r) => r.rel === '.') || null
  const lines = new Map()
  for (const c of doc.components || []) for (const s of c.sources || []) {
    const p = parseSource(s, names)
    const root = p && (p.repo ? roots.find((r) => r.name === p.repo) : roots.find((r) => r.name === c.repo) || single)
    if (!p || !root) { problems.push(`${c.id}: source ${JSON.stringify(s)}: name its repository (repo:path:line)`); continue }
    const abs = path.resolve(root.abs, p.path)
    let real = null
    try { real = realpathSync(abs) } catch {}
    const rootReal = realpathSync(root.abs)
    if (!real || !(real === rootReal || real.startsWith(rootReal + path.sep)) || !statSync(real).isFile()) { problems.push(`${c.id}: source ${JSON.stringify(s)}: no such file in ${root.name}`); continue }
    if (p.start !== undefined) {
      if (!lines.has(real)) { try { lines.set(real, readFileSync(real, 'utf8').split('\n').length) } catch { lines.set(real, 0) } }
      const n = lines.get(real)
      if (p.start < 1 || p.end < p.start || p.end > n) problems.push(`${c.id}: source ${JSON.stringify(s)}: lines out of range (the file has ${n})`)
    }
  }
  return problems
}

// ── layout ─────────────────────────────────────────────────────────────────────────────────
export const BOX = { w: 184, h: 64, cellW: 296, cellH: 124, margin: 36 }

// Positions every component, wraps every boundary, routes every connection. Components that give
// col and row keep them; the rest are placed by flow: a column per step from the components
// nothing points to, boundaries as horizontal bands, rows ordered to cut crossings.
// → { boxes: [{ x, y, w, h, col, row }], bounds: [{ x, y, w, h, level }], routes: [{ d, lx, ly, side }],
//     W, H, problems: [string] }
export function layoutArch(doc) {
  const comps = doc.components || [], n = comps.length
  const at = new Map(comps.map((c, i) => [c.id, i]))
  const conns = (doc.connections || []).filter((e) => at.has(e.from) && at.has(e.to) && e.from !== e.to)
  const out = comps.map(() => []), inn = comps.map(() => [])
  for (const e of conns) { const a = at.get(e.from), b = at.get(e.to); if (!out[a].includes(b)) { out[a].push(b); inn[b].push(a) } }
  // ranks: longest path over the connections, back edges (DFS) ignored
  const state = new Array(n).fill(0), back = new Set()
  for (let s = 0; s < n; s++) {
    if (state[s]) continue
    const stack = [[s, 0]]; state[s] = 1
    while (stack.length) {
      const top = stack[stack.length - 1], [u, i] = top
      if (i < out[u].length) { top[1]++; const v = out[u][i]; if (state[v] === 1) back.add(`${u}>${v}`); else if (!state[v]) { state[v] = 1; stack.push([v, 0]) } }
      else { state[u] = 2; stack.pop() }
    }
  }
  const indeg = new Array(n).fill(0)
  for (let u = 0; u < n; u++) for (const v of out[u]) if (!back.has(`${u}>${v}`)) indeg[v]++
  const rank = new Array(n).fill(0), queue = []
  for (let u = 0; u < n; u++) if (!indeg[u]) queue.push(u)
  while (queue.length) { const u = queue.shift(); for (const v of out[u]) if (!back.has(`${u}>${v}`)) { rank[v] = Math.max(rank[v], rank[u] + 1); if (!--indeg[v]) queue.push(v) } }

  const bounds = (doc.boundaries || []).map((b) => ({ ...b, set: new Set((b.wraps || []).filter((w) => at.has(w)).map((w) => at.get(w))) })).filter((b) => b.set.size)
  const inside = (a, b) => a !== b && [...a.set].every((x) => b.set.has(x)) && (a.set.size < b.set.size || bounds.indexOf(a) > bounds.indexOf(b))
  const tops = bounds.filter((b) => !bounds.some((o) => inside(b, o)))
  const col = new Array(n).fill(null), row = new Array(n).fill(null)
  const fixed = comps.map((c) => Number.isInteger(c.col) && Number.isInteger(c.row))
  comps.forEach((c, i) => { if (fixed[i]) { col[i] = c.col; row[i] = c.row } })
  if (fixed.some(Boolean)) {
    const used = new Set(comps.map((c, i) => (fixed[i] ? `${c.col},${c.row}` : null)).filter(Boolean))
    comps.forEach((c, i) => { if (fixed[i]) return; col[i] = rank[i]; let r = 0; while (used.has(`${col[i]},${r}`)) r++; row[i] = r; used.add(`${col[i]},${r}`) })
  } else {
    // A source (nothing points to it) moves right, next to the first thing it feeds; a component
    // with no line at all stays in column 0.
    for (let u = 0; u < n; u++) if (!inn[u].length && out[u].length) rank[u] = Math.max(0, Math.min(...out[u].map((v) => rank[v])) - 1)
    // Each top-level boundary is a band of rows of its own, in declaration order, as tall as its
    // fullest column; rows inside it are ordered to cut crossings (barycentre sweeps), nested
    // boundaries kept together. Components in no boundary are then placed in their column, at the
    // row their neighbours pull them to, never inside a band that spans that column.
    const bandOf = comps.map((_, i) => tops.findIndex((b) => b.set.has(i)))
    const innerKey = comps.map((_, i) => { const k = bounds.findIndex((b) => !tops.includes(b) && b.set.has(i)); return k < 0 ? 999 : k })
    const pos = new Array(n).fill(0)
    const placed = new Array(n).fill(false)
    const spans = []
    let offset = 0
    tops.forEach((_, band) => {
      const mem = comps.map((_, i) => i).filter((i) => bandOf[i] === band)
      const cols = new Map()
      for (const i of mem) (cols.get(rank[i]) || cols.set(rank[i], []).get(rank[i])).push(i)
      const ks = [...cols.keys()].sort((a, b) => a - b)
      for (const k of ks) cols.get(k).sort((a, b) => innerKey[a] - innerKey[b] || a - b).forEach((i, p) => { pos[i] = p })
      const bary = (i, nb) => { const ys = nb.filter((j) => bandOf[j] === band).map((j) => pos[j]); return ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : pos[i] }
      for (let sweep = 0; sweep < 4; sweep++) {
        const order = sweep % 2 ? ks.slice().reverse() : ks
        for (const k of order) cols.get(k).sort((a, b) => innerKey[a] - innerKey[b] || bary(a, sweep % 2 ? out[a] : inn[a]) - bary(b, sweep % 2 ? out[b] : inn[b]) || a - b).forEach((i, p) => { pos[i] = p })
      }
      const height = Math.max(...ks.map((k) => cols.get(k).length))
      for (const k of ks) { const list = cols.get(k); list.forEach((i) => { col[i] = rank[i]; row[i] = offset + (height - list.length) / 2 + pos[i]; placed[i] = true }) }
      spans.push({ c0: ks[0], c1: ks[ks.length - 1], r0: offset, r1: offset + height - 1 })
      offset += height + 0.6
    })
    // free components: two passes, the second using where the first put the others
    const free = comps.map((_, i) => i).filter((i) => bandOf[i] < 0).sort((a, b) => rank[a] - rank[b] || a - b)
    const nb = comps.map((_, i) => [...new Set([...inn[i], ...out[i]])])
    for (let pass = 0; pass < 2; pass++) {
      const taken = []
      for (const i of free) placed[i] = pass > 0 && placed[i]
      for (const i of free) {
        const ys = nb[i].filter((j) => placed[j] && j !== i).map((j) => row[j])
        const target = ys.length ? Math.round((ys.reduce((a, y) => a + y, 0) / ys.length) * 2) / 2 : 0
        const ok = (r) => !spans.some((sp) => rank[i] >= sp.c0 && rank[i] <= sp.c1 && r > sp.r0 - 1.1 && r < sp.r1 + 1.1) && !taken.some(([c, y]) => c === rank[i] && Math.abs(y - r) < 1)
        let r = target
        for (let k = 1; !ok(r) && k < 400; k++) r = target + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.5
        col[i] = rank[i]; row[i] = r; placed[i] = true; taken.push([rank[i], r])
      }
    }
    const minRow = Math.min(...row)
    for (let i = 0; i < n; i++) row[i] -= minRow
  }
  const { w, h, cellW, cellH, margin } = BOX
  const level = bounds.map(() => 0)
  for (let pass = 0; pass < bounds.length; pass++) bounds.forEach((b, k) => { for (const [j, o] of bounds.entries()) if (inside(o, b)) level[k] = Math.max(level[k], level[j] + 1) })
  const top = margin + (bounds.length ? 26 + 14 * Math.max(0, ...level) : 0)
  const boxes = comps.map((_, i) => ({ x: margin + 14 * (bounds.length ? 1 + Math.max(0, ...level) : 0) + col[i] * cellW, y: top + row[i] * cellH, w, h, col: col[i], row: row[i] }))
  const rects = bounds.map((b, k) => {
    const pad = 12 + 14 * level[k], ms = [...b.set].map((i) => boxes[i])
    const x0 = Math.min(...ms.map((m) => m.x)) - pad, y0 = Math.min(...ms.map((m) => m.y)) - pad - 20
    return { x: x0, y: y0, w: Math.max(...ms.map((m) => m.x + m.w)) + pad - x0, h: Math.max(...ms.map((m) => m.y + m.h)) + pad - y0, level: level[k], label: b.label, kind: b.kind || 'group', set: b.set }
  })
  const problems = []
  const hit = (r, m) => m.x < r.x + r.w && m.x + m.w > r.x && m.y < r.y + r.h && m.y + m.h > r.y
  rects.forEach((r) => comps.forEach((c, i) => { if (!r.set.has(i) && hit(r, boxes[i])) problems.push(`layout: ${c.id} sits inside the boundary "${r.label}" but is not wrapped by it: move it (col/row) or wrap it`) }))
  rects.forEach((r, a) => rects.forEach((o, b) => { if (a < b && hit(r, o) && !inside(bounds[a], bounds[b]) && !inside(bounds[b], bounds[a])) problems.push(`layout: the boundaries "${r.label}" and "${o.label}" overlap: give their components separate rows or columns`) }))

  // routes: side to side, ports spread along a side, a cubic curve between
  const ends = new Map() // `${box}:${side}` → [{ conn, end, other }]
  const sideOf = (A, B) => { const dx = B.x - A.x, dy = B.y - A.y; return Math.abs(dx) >= w * 0.6 ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'] }
  const conAll = doc.connections || []
  const sides = conAll.map((e) => {
    if (!at.has(e.from) || !at.has(e.to) || e.from === e.to) return null
    const a = at.get(e.from), b = at.get(e.to), [sa, sb] = sideOf(boxes[a], boxes[b])
    const add = (box, side, k, end, other) => { const key = `${box}:${side}`; (ends.get(key) || ends.set(key, []).get(key)).push({ k, end, other }) }
    add(a, sa, conAll.indexOf(e), 0, b); add(b, sb, conAll.indexOf(e), 1, a)
    return [a, sa, b, sb]
  })
  const port = new Map()
  for (const [key, list] of ends) {
    const [box, side] = key.split(':'), B = boxes[Number(box)], vert = side === 'left' || side === 'right'
    list.sort((p, q) => (vert ? boxes[p.other].y - boxes[q.other].y : boxes[p.other].x - boxes[q.other].x) || p.k - q.k)
    const span = vert ? h : w, step = Math.min(vert ? 14 : 22, span / (list.length + 1))
    list.forEach((p, i) => {
      const off = (i - (list.length - 1) / 2) * step
      port.set(`${p.k}:${p.end}`, side === 'right' ? [B.x + w, B.y + h / 2 + off] : side === 'left' ? [B.x, B.y + h / 2 + off] : side === 'bottom' ? [B.x + w / 2 + off, B.y + h] : [B.x + w / 2 + off, B.y])
    })
  }
  const labels = []
  const routes = conAll.map((e, k) => {
    if (!sides[k]) return null
    const [, sa, , sb] = sides[k]
    const [x1, y1] = port.get(`${k}:0`), [x2, y2] = port.get(`${k}:1`)
    const dir = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] }
    const reach = Math.max(36, (sa === 'left' || sa === 'right' ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) / 2)
    const c1 = [x1 + dir[sa][0] * reach, y1 + dir[sa][1] * reach], c2 = [x2 + dir[sb][0] * reach, y2 + dir[sb][1] * reach]
    const t = 0.5, u = 1 - t, bz = (p0, p1, p2, p3) => u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
    let lx = bz(x1, c1[0], c2[0], x2), ly = bz(y1, c1[1], c2[1], y2)
    // a label fits the gap its line crosses: cut to `chars`, the full text stays in the tooltip
    const room = sa === 'left' || sa === 'right' ? Math.max(48, Math.abs(x2 - x1) - 14) : 200
    const chars = Math.max(4, Math.floor((room - 12) / 6.2))
    const tw = Math.min(room, 6.2 * Math.min(chars, String(e.label || '').length) + 12)
    for (let tries = 0; tries < 6 && labels.some(([ox, oy, ow]) => Math.abs(ox - lx) * 2 < ow + tw && Math.abs(oy - ly) < 18); tries++) ly += 18
    if (e.label) labels.push([lx, ly, tw])
    return { d: `M${x1.toFixed(1)},${y1.toFixed(1)} C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, lx: Math.round(lx), ly: Math.round(ly), tw: Math.round(tw), chars }
  })
  const W = Math.max(margin * 2 + w, ...boxes.map((b) => b.x + b.w + margin), ...rects.map((r) => r.x + r.w + margin), ...labels.map(([x, , tw]) => x + tw / 2 + 8))
  const H = Math.max(margin * 2 + h, ...boxes.map((b) => b.y + b.h + margin), ...rects.map((r) => r.y + r.h + margin), ...labels.map(([, y]) => y + 20))
  return { boxes, bounds: rects.map(({ set, ...r }) => r), routes, W: Math.ceil(W), H: Math.ceil(H), problems }
}

// ── the draft ──────────────────────────────────────────────────────────────────────────────
// idx as for bindCode, plus files[].lang. → a diagram whose every name and type is a guess.
export function draftArch(idx, { title = 'System architecture', now = new Date(), maxPerRepo = 12 } = {}) {
  const sys = systemMap(idx.files, idx.nodes, idx.edges)
  const multi = idx.repos.length > 1
  const fileModule = new Map(sys.fileModule)
  const byFile = new Map(idx.files.map((f) => [f.id, f]))
  const modFiles = sys.modules.map(() => [])
  for (const [fid, mi] of fileModule) modFiles[mi].push(byFile.get(fid))
  const imports = new Map()
  for (const im of idx.imports) (imports.get(im.file_id) || imports.set(im.file_id, []).get(im.file_id)).push(im.source)
  const linked = new Set(sys.links.flatMap(([a, b]) => [a, b]))
  const keep = new Set(), skipped = []
  for (const repo of idx.repos) {
    const ms = sys.modules.map((m, i) => ({ m, i })).filter(({ m }) => m.repo === repo)
    const ranked = ms.slice().sort((a, b) => Number(linked.has(b.i)) - Number(linked.has(a.i)) || b.m.files - a.m.files || a.i - b.i)
    ranked.forEach(({ m, i }, k) => { if (k < maxPerRepo && (linked.has(i) || m.files >= 2 || ms.length <= 3)) keep.add(i); else skipped.push(m) })
  }
  const keys = new Set(sys.modules.map((m) => `${m.repo}\0${m.key}`))
  const components = [], idOf = new Map()
  const used = new Set()
  const freshId = (base) => { let id = slugId(base), k = 2; while (used.has(id)) id = `${slugId(base).slice(0, 60)}-${k++}`; used.add(id); return id }
  for (const i of [...keep].sort((a, b) => a - b)) {
    const m = sys.modules[i], fs = modFiles[i]
    const langs = Object.entries(fs.reduce((a, f) => ((a[f.lang] = (a[f.lang] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([l]) => l)
    const sources = [...new Set(fs.flatMap((f) => imports.get(f.id) || []))]
    const deeper = [...keys].some((k) => k.startsWith(`${m.repo}\0${m.key}/`))
    const pattern = m.key === '(root)' ? '*' : deeper ? `${m.key}/*` : m.key
    const id = freshId(multi ? `${m.repo}-${m.key === '(root)' ? 'root' : m.key}` : m.key === '(root)' ? 'root' : m.key)
    idOf.set(i, id)
    components.push({ id, label: m.key === '(root)' ? `${m.repo} (top-level files)` : m.key, sublabel: `${m.files} file${m.files === 1 ? '' : 's'} · ${langs.slice(0, 2).join(', ')}`, type: guessType(m.key, langs, sources), ...(multi ? { repo: m.repo } : {}), paths: [pattern] })
  }
  const connections = []
  for (const [a, b, n] of sys.links) if (idOf.has(a) && idOf.has(b)) connections.push({ from: idOf.get(a), to: idOf.get(b), label: `${n} file pair${n === 1 ? '' : 's'}` })
  // external services, from the imports of the drawn modules' files
  for (const k of KNOWN) {
    const users = new Map()
    for (const [i, id] of idOf) for (const f of modFiles[i]) for (const s of imports.get(f.id) || []) if (k.imports.some((p) => importMatches(s, p))) users.set(id, (users.get(id) || new Set()).add(s))
    if (!users.size) continue
    const seen = [...new Set([...users.values()].flatMap((s) => [...s]))]
    const pats = k.imports.filter((p) => seen.some((s) => importMatches(s, p)))
    const id = freshId(k.id)
    components.push({ id, label: k.label, sublabel: k.sublabel || seen.slice(0, 2).join(', '), type: k.type, imports: pats })
    for (const u of users.keys()) connections.push({ from: u, to: id, label: k.via })
  }
  const boundaries = multi ? idx.repos.map((r) => ({ label: r, kind: 'repo', wraps: components.filter((c) => c.repo === r).map((c) => c.id) })).filter((b) => b.wraps.length) : []
  const cards = [{ title: 'How this draft was made', color: 'slate', items: [
    'One component per module of the system map (a folder of production code), typed by its folder names and the frameworks it imports.',
    'External services come from imports of known client libraries; a datastore reached only through config is not here yet.',
    'A line is a module using another through links resolved by syntax; its label counts the file pairs.',
    'Every name, type and grouping is a guess until refined: /grimoire:architecture.',
  ] }]
  if (skipped.length) cards.push({ title: 'Not drawn', color: 'amber', items: skipped.slice(0, 12).map((m) => `${multi ? `${m.repo}:` : ''}${m.key} (${m.files} file${m.files === 1 ? '' : 's'})`).concat(skipped.length > 12 ? [`…and ${skipped.length - 12} more`] : []) })
  return {
    schema: 1, title, draft: true,
    summary: `Drafted from the code graph on ${now.toISOString().slice(0, 10)}: modules as components, imports of known client libraries as external services, file links as connections.`,
    components, boundaries, connections, cards,
  }
}

// ── everything the page and the check need about one diagram ───────────────────────────────
export function analyze(doc, idx, roots) {
  const { errors, warnings } = validate(doc)
  if (errors.length) return { errors, warnings, info: [] }
  const code = bindCode(doc, idx)
  const lay = layoutArch(doc)
  const info = []
  doc.components.forEach((c, i) => { for (const p of code.unmatched[i]) errors.push(`${c.id}: paths ${JSON.stringify(p)} matches no indexed production file`) })
  if (roots) errors.push(...checkSources(doc, roots))
  warnings.push(...lay.problems)
  const isCode = doc.components.map((c, i) => code.members[i].length > 0 || !!(c.imports && c.imports.length))
  const at = new Map(doc.components.map((c, i) => [c.id, i]))
  ;(doc.connections || []).forEach((e, k) => {
    const a = at.get(e.from), b = at.get(e.to)
    if (!isCode[a] || !code.members[a].length || !isCode[b] || code.evidence[k] || e.via) return
    warnings.push(code.reverse[k]
      ? `${e.from} → ${e.to}: the code links the other way (${e.to} uses ${e.from} in ${code.reverse[k]} file pair${code.reverse[k] === 1 ? '' : 's'}); flip it, or say in "via" why it runs this way`
      : `${e.from} → ${e.to}: no link in the graph; if it goes over HTTP, a queue or config, say so in "via"`)
  })
  for (const [a, b, n] of code.ghosts.slice(0, 15)) warnings.push(`${a} uses ${b} (${n} file pair${n === 1 ? '' : 's'} in the graph), but no line is drawn between them`)
  if (code.ghosts.length > 15) warnings.push(`…and ${code.ghosts.length - 15} more undrawn links`)
  for (const [f, cs] of code.overlap) warnings.push(`${f} is in several components (${cs.join(', ')}): narrow their paths`)
  doc.components.forEach((c, i) => { if (!code.members[i].length && !(c.imports && c.imports.length) && !(c.sources && c.sources.length) && c.type !== 'external') warnings.push(`${c.id}: no paths, imports or sources: nothing ties it to the code`) })
  if (code.coverage.total) info.push(`${code.coverage.covered} of ${code.coverage.total} production files are in a component${code.coverage.uncovered.length ? `; not covered: ${code.coverage.uncovered.slice(0, 6).map(([d, n]) => `${d} (${n})`).join(', ')}${code.coverage.uncovered.length > 6 ? ', …' : ''}` : ''}`)
  // a line the graph could confirm: from code to code, unless it says it runs elsewhere (via) and the graph agrees
  const checkable = (doc.connections || []).map((e, k) => code.members[at.get(e.from)].length > 0 && isCode[at.get(e.to)] && (!e.via || code.evidence[k] > 0))
  const n = checkable.filter(Boolean).length, seen = checkable.filter((c, k) => c && code.evidence[k] > 0).length
  const checked = n ? `${seen} of ${n} connections between code components seen in the graph` : ''
  if (checked) info.push(checked)
  return { errors, warnings, info, code, layout: lay, checkable, checked }
}

// ── loading ────────────────────────────────────────────────────────────────────────────────
export function loadIndex(db) {
  return {
    repos: db.prepare('SELECT name FROM repos ORDER BY name').all().map((r) => r.name),
    files: db.prepare('SELECT id, repo, path, lang, is_test, node_id FROM files ORDER BY repo, path').all(),
    nodes: db.prepare("SELECT id, file_id FROM nodes WHERE kind != 'file'").all(),
    edges: db.prepare('SELECT src, dst, kind, confidence FROM edges').all(),
    imports: db.prepare('SELECT file_id, source FROM imports').all(),
  }
}

// every *.architecture.json under the directory: [{ file, doc } | { file, error }]
export function readDiagrams(dir) {
  if (!dir || !existsSync(dir)) return []
  const out = []
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(d, e.name), r)
      else if (e.isFile() && e.name.endsWith(SUFFIX)) {
        try { out.push({ file: r, doc: JSON.parse(readFileSync(path.join(d, e.name), 'utf8')) } ) } catch (err) { out.push({ file: r, error: `does not parse: ${err.message}` }) }
      }
    }
  }
  walk(dir, '')
  return out
}

export { docRoots }
