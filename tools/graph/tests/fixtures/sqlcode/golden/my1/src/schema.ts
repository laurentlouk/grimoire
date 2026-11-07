// Synthetic. drizzle/ beside it was generated from this file by drizzle-kit 0.31 (stable): a golden expectation.
import { mysqlTable, mysqlEnum, serial, int, tinyint, smallint, mediumint, bigint, varchar, char, text, tinytext, mediumtext, longtext, boolean, timestamp, datetime, date, time, year, decimal, float, double, real, json, binary, varbinary, index, uniqueIndex, primaryKey, unique, foreignKey } from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'

export const accounts = mysqlTable('accounts', {
  id: int('id').autoincrement().primaryKey(),
  sid: serial('sid'),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }),
  bio: text('bio'),
  age: int('age').notNull(),
  uage: int('uage', { unsigned: true }),
  tiny: tinyint('tiny'),
  utiny: tinyint('utiny', { unsigned: true }),
  small: smallint('small'),
  mid: mediumint('mid'),
  big: bigint('big', { mode: 'number' }).notNull(),
  ubig: bigint('ubig', { mode: 'number', unsigned: true }),
  price: decimal('price', { precision: 10, scale: 2 }),
  price2: decimal('price2'),
  uprice: decimal('uprice', { precision: 10, scale: 2, unsigned: true }),
  fl: float('fl'),
  fl2: float('fl2', { precision: 10, scale: 2 }),
  db: double('db'),
  db2: double('db2', { precision: 10, scale: 2 }),
  active: boolean('active').default(true),
  role: mysqlEnum('role', ['admin', 'member']).default('member'),
  meta: json('meta'),
  created: timestamp('created').defaultNow().notNull(),
  created3: timestamp('created3', { fsp: 3 }).defaultNow(),
  dt: datetime('dt'),
  dt3: datetime('dt3', { fsp: 3 }),
  day: date('day'),
  tm: time('tm', { fsp: 2 }),
  yr: year('yr'),
  tt: tinytext('tt'),
  mt: mediumtext('mt'),
  lt: longtext('lt'),
  ch: char('ch', { length: 3 }),
  bin: binary('bin', { length: 16 }),
  vbin: varbinary('vbin', { length: 16 }),
  dflt: text('dflt'),
  vdflt: varchar('vdflt', { length: 20 }).default("it's"),
  n: int('n').default(0),
  f: real('f').default(1.5),
  neg: int('neg').default(-1),
  upd: timestamp('upd').onUpdateNow(),
  cid: varchar('cid', { length: 20 }).$defaultFn(() => 'x'),
  nowf: timestamp('nowf').default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('acc_name_age_idx').on(t.name, t.age),
  uniqueIndex('acc_email_name_uq').on(t.email, t.name),
])

export const posts = mysqlTable('posts', {
  id: int('id').autoincrement().primaryKey(),
  authorId: int('author_id').notNull().references(() => accounts.id),
  editorId: int('editor_id').references(() => accounts.id, { onDelete: 'cascade', onUpdate: 'set null' }),
  title: varchar('title', { length: 255 }),
  slug: varchar('slug', { length: 100 }).unique('posts_slug_u'),
})

export const membership = mysqlTable('membership', {
  a: int('a').notNull(),
  b: int('b').notNull(),
}, (t) => [primaryKey({ columns: [t.a, t.b] }), unique('mem_ab').on(t.a, t.b)])
