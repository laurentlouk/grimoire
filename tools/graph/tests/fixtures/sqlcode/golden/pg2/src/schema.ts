// Synthetic. drizzle/ beside it was generated from this file by drizzle-kit 0.31 (stable): a golden expectation.
import { pgTable, pgSchema, pgEnum, serial, bigserial, smallserial, integer, text, varchar, real, doublePrecision, timestamp, boolean, interval, uuid, index, uniqueIndex, primaryKey, unique, date, jsonb, json, numeric } from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
}
const id = () => uuid().primaryKey().defaultRandom()

export const mood = pgEnum('mood', ['sad', 'ok', 'happy'])
export const app = pgSchema('app')
export const appRole = app.enum('app_role', ['a', 'b'])

export const users = pgTable('users', {
  id: id(),
  displayName: text().notNull(),
  firstName: varchar({ length: 50 }),
  s1: serial().notNull(),
  s2: serial(),
  bs: bigserial({ mode: 'number' }),
  ss: smallserial(),
  mood: mood().default('ok'),
  moods: mood().array(),
  rate: real().default(1.0),
  rate2: real().default(0.50),
  rate3: doublePrecision().default(1e3),
  rate4: integer().default(1_000),
  iv: interval(),
  iv2: interval({ fields: 'day to second', precision: 3 }),
  day: date({ mode: 'string' }).default('2020-01-01'),
  j: jsonb().default({ a: 1 }),
  j2: json().default([]),
  price: numeric({ precision: 12, scale: 4 }),
  emailAddr: text(),
  ...timestamps,
}, (t) => [
  uniqueIndex('users_email_lower').on(sql`lower(${t.emailAddr})`),
  index('users_created_desc').on(t.createdAt.desc()),
  index('users_gin').using('gin', t.j),
  unique().on(t.firstName, t.displayName),
])

export const appUsers = app.table('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid().references(() => users.id, { onDelete: 'restrict' }),
  role: appRole().notNull().default('a'),
})

export const usersRelations = relations(users, ({ many }) => ({ appUsers: many(appUsers) }))
