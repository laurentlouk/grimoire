// grimoire graph · data · reader: whether a source file is a schema migration written as code, by its
// path and content alone (linear, run at inspection). The SQL a migration sends is the store's history,
// replayed or read as a migration where an extractor reads its tool (alembic.mjs, code-migrations.mjs), or
// left to the tool (Django's migrations: django.mjs reads the models): never queries code sends today,
// compared with today's model (extractors/sql-queries.mjs leaves these files out).
//   - an Alembic revision: a Python file defining `upgrade()` and assigning `revision`;
//   - a Django migration: a Python file in a `migrations/` folder declaring `class …(migrations.Migration)`;
//   - a TypeScript or JavaScript migration (TypeORM's, Knex's, any tool's of that shape): a
//     `MigrationInterface`, an exported `up` (`exports.up`, `export async function up`, `export const up`,
//     `module.exports = { up, down }`: both members, an `up` alone is too common a method name).
// → 'alembic' | 'django' | 'code' | null
const PY = /\.py$/i
const JS = /\.(?:ts|mts|cts|js|mjs|cjs)$/i
const DTS = /\.d\.[cm]?ts$/i
const UPGRADE = /^def[ \t]+upgrade[ \t]*\(/m
const REVISION = /^revision[ \t]*(?::[^=\n]{0,80})?=/m
const DJANGO_DIR = /(^|\/)migrations\/[^/]+\.py$/
const DJANGO_CLASS = /\bclass[ \t]+\w+[ \t]*\([ \t]*migrations\.Migration[ \t]*\)/
const SHAPE = /\bMigrationInterface\b|\bexports\.up\b|\bexport[ \t]+(?:async[ \t]+)?function[ \t]+up\b|\bexport[ \t]+const[ \t]+up\b/
const CJS = /\bmodule\.exports[ \t]*=/
const UP_MEMBER = /(?:^|[\s,{])(?:async[ \t]+)?up[ \t]*(?::|\()/m
const DOWN_MEMBER = /(?:^|[\s,{])(?:async[ \t]+)?down[ \t]*(?::|\()/m

export function migrationFile(p, text) {
  if (PY.test(p)) {
    if (UPGRADE.test(text) && REVISION.test(text)) return 'alembic'
    if (DJANGO_DIR.test(p) && DJANGO_CLASS.test(text)) return 'django'
    return null
  }
  if (JS.test(p) && !DTS.test(p) && (SHAPE.test(text) || (CJS.test(text) && UP_MEMBER.test(text) && DOWN_MEMBER.test(text)))) return 'code'
  return null
}
