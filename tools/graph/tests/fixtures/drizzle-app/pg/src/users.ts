import { eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './db/client'
import { comments, posts, users as people } from './db/schema'
import * as schema from './db/schema'

export async function findUser() {
  return db.select({ id: people.id, name: people.name }).from(people).where(eq(people.email, 'canary-dz-1'))
}

export async function postsWithAuthors() {
  return db.select().from(posts).innerJoin(people, eq(posts.authorId, people.id)).orderBy(posts.createdAt)
}

export async function renameUser(id: number, name: string) {
  return db.update(schema.users).set({ name }).where(eq(schema.users.id, id)).returning()
}

export async function createUserWithPost(email: string, title: string) {
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(people).values({ email, name: 'canary-dz-2' }).returning({ id: people.id })
    await tx.insert(posts).values({ title, authorId: u.id })
  })
}

export async function feed() {
  return db.query.posts.findMany({
    columns: { id: true, title: true },
    where: (p, { eq }) => eq(p.authorId, 7),
    with: { author: true, comments: true },
  })
}

export async function purge(id: number) {
  await db.delete(posts).where(eq(posts.id, id))
  return db.execute(sql`delete from ${comments} where ${comments.postId} = ${id}`)
}

export const countPosts = () => db.$count(posts)

const author = alias(people, 'author')
export const editors = () => db.select().from(posts).leftJoin(author, eq(author.id, posts.authorId))

export function caller() {
  return findUser()
}
