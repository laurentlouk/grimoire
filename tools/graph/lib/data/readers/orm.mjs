// grimoire graph · data · what the ORM extractors share (extractors/rails.mjs, django.mjs, sqlalchemy.mjs,
// typeorm.mjs, jpa.mjs, mongoose.mjs): the folder a set of model files shares, counts in words.
import path from 'node:path'

const P = path.posix
// the folder every path is under ('.' at the root)
export function common(paths) {
  if (!paths.length) return '.'
  const parts = paths.map((p) => P.dirname(p).split('/'))
  const out = []
  for (let i = 0; ; i++) { const s = parts[0][i]; if (s === undefined || parts.some((x) => x[i] !== s)) break; out.push(s) }
  return out.length && out[0] !== '.' ? out.join('/') : '.'
}
export const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// the folder a glob names, up to its first wildcard (`src/migration/*.ts` → src/migration)
export function globDir(glob) {
  const parts = String(glob).replace(/\\/g, '/').split('/')
  const i = parts.findIndex((s) => /[*?{[]/.test(s))
  const dir = (i < 0 ? parts.slice(0, -1) : parts.slice(0, i)).join('/')
  return P.normalize(dir || '.').replace(/\/+$/, '') || '.'
}
