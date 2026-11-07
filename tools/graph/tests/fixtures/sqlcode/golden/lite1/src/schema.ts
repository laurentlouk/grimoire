// Synthetic. drizzle/ beside it was generated from this file by drizzle-kit 0.31 (stable): a golden expectation.
import { sqliteTable, integer, text, real, blob, numeric, index, uniqueIndex, primaryKey, foreignKey, unique } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name', { length: 100 }),
  bio: text('bio').notNull(),
  age: integer('age').notNull(),
  score: real('score'),
  raw: blob('raw'),
  rawj: blob('rawj', { mode: 'json' }),
  rawb: blob('rawb', { mode: 'bigint' }),
  nm: numeric('nm'),
  flag: integer('flag', { mode: 'boolean' }).default(true),
  flag0: integer('flag0', { mode: 'boolean' }).notNull().default(false),
  ts: integer('ts', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  tsms: integer('tsms', { mode: 'timestamp_ms' }).default(sql`(unixepoch() * 1000)`),
  role: text('role', { enum: ['admin', 'member'] }).default('member'),
  js: text('js', { mode: 'json' }).$type<{ a: number }>(),
  dflt: text('dflt').default("it's"),
  n: integer('n').default(0),
  f: real('f').default(1.5),
  neg: integer('neg').default(-1),
  str0: text('str0').default(''),
  cid: text('cid').$defaultFn(() => 'x'),
  upd: integer('upd', { mode: 'timestamp' }).$onUpdate(() => new Date()),
  gen: integer('gen').generatedAlwaysAs(sql`age + 1`),
  gens: integer('gens').generatedAlwaysAs(sql`age + 2`, { mode: 'stored' }),
  ct: text('ct').default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('acc_name_age_idx').on(t.name, t.age),
  uniqueIndex('acc_email_name_uq').on(t.email, t.name),
  index('partial_idx').on(t.bio).where(sql`${t.age} > 5`),
])

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey(),
  authorId: integer('author_id').notNull().references(() => accounts.id),
  editorId: integer('editor_id').references(() => accounts.id, { onDelete: 'cascade', onUpdate: 'set null' }),
  title: text('title'),
  slug: text('slug').unique('posts_slug_u'),
})

export const membership = sqliteTable('membership', {
  a: integer('a').notNull(),
  b: integer('b').notNull(),
}, (t) => [primaryKey({ columns: [t.a, t.b] }), unique('mem_ab').on(t.a, t.b)])

export const withFk = sqliteTable('with_fk', {
  x: integer('x').notNull(),
  y: integer('y').notNull(),
}, (t) => [foreignKey({ columns: [t.x, t.y], foreignColumns: [membership.a, membership.b] }).onDelete('cascade')])
