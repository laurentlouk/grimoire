// Synthetic. drizzle/ beside it was generated from this file by drizzle-kit 0.31 (stable): a golden expectation.
import { pgTable, pgEnum, serial, integer, bigint, smallint, text, varchar, char, boolean, timestamp, date, time, numeric, decimal, doublePrecision, real, json, jsonb, uuid, index, uniqueIndex, primaryKey, unique, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const role = pgEnum('role', ['admin', 'member'])

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  uid: uuid('uid').defaultRandom().notNull(),
  email: text('email').notNull().unique(),
  name: varchar('name', { length: 100 }),
  vc: varchar('vc'),
  bio: text('bio').notNull(),
  age: integer('age').notNull(),
  big: bigint('big', { mode: 'number' }).notNull(),
  big2: bigint('big2', { mode: 'bigint' }),
  small: smallint('small'),
  score: doublePrecision('score'),
  rl: real('rl'),
  price: numeric('price', { precision: 10, scale: 2 }),
  price2: numeric('price2'),
  dec: decimal('dec', { precision: 5 }),
  active: boolean('active').default(true),
  role: role('role').default('member'),
  meta: jsonb('meta'),
  meta2: json('meta2'),
  created: timestamp('created').defaultNow().notNull(),
  tz: timestamp('tz', { withTimezone: true, precision: 3 }).defaultNow(),
  tz0: timestamp('tz0', { withTimezone: true }),
  ts6: timestamp('ts6', { precision: 6 }),
  day: date('day'),
  tm: time('tm', { precision: 2, withTimezone: true }),
  tm0: time('tm0'),
  tags: text('tags').array(),
  tags2: integer('tags2').array().notNull().default(sql`'{}'::int[]`),
  dflt: text('dflt').default("it's"),
  n: integer('n').default(0),
  f: real('f').default(1.5),
  neg: integer('neg').default(-1),
  ch: char('ch', { length: 3 }),
  ch1: char('ch1'),
  txt: text('txt').default(sql`now()::text`),
  upd: timestamp('upd').$onUpdate(() => new Date()),
  cid: text('cid').$defaultFn(() => 'x'),
  gen: integer('gen').generatedAlwaysAs(sql`age + 1`),
  ident: integer('ident').generatedAlwaysAsIdentity(),
  str0: text('str0').default(''),
  bigdef: bigint('bigdef', { mode: 'number' }).default(9007199254740991),
  tsdef: timestamp('tsdef', { mode: 'string' }).default('2020-01-01 00:00:00'),
}, (t) => [
  index('acc_name_age_idx').on(t.name, t.age),
  uniqueIndex('acc_email_name_uq').on(t.email, t.name),
  index('partial_idx').on(t.bio).where(sql`${t.active}`),
])

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').notNull().references(() => accounts.id),
  editorId: integer('editor_id').references(() => accounts.id, { onDelete: 'cascade', onUpdate: 'set null' }),
  title: text('title'),
  slug: text('slug').unique('posts_slug_u'),
})

export const membership = pgTable('membership', {
  a: integer('a').notNull(),
  b: integer('b').notNull(),
}, (t) => [primaryKey({ columns: [t.a, t.b] }), unique('mem_ab').on(t.a, t.b)])

export const withFk = pgTable('with_fk', {
  x: integer('x').notNull(),
  y: integer('y').notNull(),
}, (t) => [foreignKey({ columns: [t.x, t.y], foreignColumns: [membership.a, membership.b] }).onDelete('cascade')])
