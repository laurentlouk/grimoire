// grimoire · a tripwire that keeps a private project's names out of this public repository. Read by
// the drift check (group 11): every tracked text file is lowercased and split into tokens on
// [a-z0-9]+, and each token is compared, by SHA-256, against a frozen deny list. A name of 5 letters
// or more also hits inside a longer token, so joined forms (`<name>app`, camelCase `<name>Engineer`)
// are caught. A shorter one, such as a tracker's team key, hits only as a whole token, so common
// words that contain it never do. A hit is reported as its file and line, never as the word.
//
// The list holds hashes so this file does not spell the names. It is a tripwire against putting
// them back by accident, not secrecy: a short word's unsalted hash can be brute-forced.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const sha256hex = (s) => createHash('sha256').update(s).digest('hex')

/** A deny entry for a word: its hash and length, never the word. Tests build synthetic ones with it. */
export const denyEntry = (word) => ({ hash: sha256hex(String(word).toLowerCase()), length: String(word).length })

// The frozen list: a private project's name, a second private repository's name, and the project's
// tracker team key (whole token only).
export const DENY = [
  { hash: 'efff57b734e0bf4aed38120c31da21acfd14b8d68ea31d5a89b883cb70ca78b9', length: 5 },
  { hash: '33d7aa122273c9d16bffe94c9a80a3bb0d909940e821f5ac193885c5e6a7a73f', length: 7 },
  { hash: '2e81e88f103bc4346870c197caaea4994d57557a380805afafd8a2b3e6f9ee88', length: 3 },
]
export const JOINED_MIN = 5 // a name this long or longer also hits inside a longer token
export const MAX_BYTES = 2 * 1024 * 1024 // larger files are skipped, as are binaries
export const MESSAGE = 'a private name on the deny list'

/** A matcher over a deny list: token → true when it is, or (for a long name) contains, a denied name. */
export function matcher(deny = DENY) {
  const whole = new Set(deny.map((d) => d.hash))
  const joined = deny.filter((d) => d.length >= JOINED_MIN)
  const lengths = [...new Set(joined.map((d) => d.length))]
  const joinedHashes = new Set(joined.map((d) => d.hash))
  const tokens = new Map() // token → verdict, so a repeated token is hashed once
  const parts = new Map() // substring → verdict, shared by every token that holds it
  const part = (s) => { let v = parts.get(s); if (v === undefined) { v = joinedHashes.has(sha256hex(s)); parts.set(s, v) } return v }
  return (token) => {
    let v = tokens.get(token)
    if (v !== undefined) return v
    v = whole.has(sha256hex(token))
    for (const L of lengths) for (let i = 0; !v && i + L <= token.length; i++) v = part(token.slice(i, i + L))
    tokens.set(token, v)
    return v
  }
}

/** The 1-based lines of `text` that hold a denied name. */
export function scanText(text, match) {
  const lines = []
  String(text).split('\n').forEach((line, i) => {
    for (const t of line.toLowerCase().match(/[a-z0-9]+/g) ?? []) if (match(t)) { lines.push(i + 1); break }
  })
  return lines
}

/** The tracked files of the repository at `root` (git ls-files), or null when git cannot list them. */
export function trackedFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return null
  return r.stdout.split('\0').filter(Boolean)
}

/** Every hit in the tracked text files under `root`: [{ file, line }]. Binaries, files over MAX_BYTES and unreadable files are skipped. */
export function scanTree(root, deny = DENY, files = trackedFiles(root)) {
  if (!files) return null
  const match = matcher(deny)
  const hits = []
  for (const file of files) {
    const abs = path.join(root, file)
    let buf
    try { if (statSync(abs).size > MAX_BYTES) continue; buf = readFileSync(abs) } catch { continue }
    if (buf.subarray(0, 8000).includes(0)) continue // a binary, as git decides it
    for (const line of scanText(buf.toString('utf8'), match)) hits.push({ file, line })
  }
  return hits
}

/** The drift check's lines for the hits: the file and line, never the word. */
export const report = (hits) => hits.map((h) => `${h.file}:${h.line}: ${MESSAGE}`)
