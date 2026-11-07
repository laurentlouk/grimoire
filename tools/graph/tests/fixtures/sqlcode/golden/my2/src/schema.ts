// Synthetic. drizzle/ beside it was generated from this file by drizzle-kit 0.31 (stable): a golden expectation.
import { mysqlTable, int, varchar, serial, double, float, decimal, timestamp, datetime, text, bigint, mysqlEnum, boolean, index, unique, primaryKey } from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'
export const users = mysqlTable('users', {
  id: serial().primaryKey(),
  id2: bigint({ mode: 'number', unsigned: true }).autoincrement().notNull(),
  email: varchar({ length: 255 }).notNull(),
  d1: double({ unsigned: true }),
  f1: float({ unsigned: true }),
  d2: double({ precision: 10, scale: 2, unsigned: true }),
  createdAt: timestamp().defaultNow().notNull(),
  d3: datetime().default(sql`CURRENT_TIMESTAMP`),
  status: mysqlEnum(['a', 'b c', "d'e"]).default('a'),
  rate: float().default(1.0),
  flag: boolean().default(false),
}, (t) => [unique().on(t.email, t.status), index('st').on(t.status)])
