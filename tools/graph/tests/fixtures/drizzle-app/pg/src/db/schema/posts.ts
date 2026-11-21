import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

// author_id states no foreign key: the query API's relation (relations.ts) is all that links it
export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body'),
  authorId: integer('author_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
})
