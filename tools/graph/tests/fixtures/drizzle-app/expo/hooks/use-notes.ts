import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { notes } from '../db/schema'

export function useNotes() {
  return {
    queryFn: async () => db.select().from(notes).orderBy(desc(notes.createdAt)),
  }
}

export async function saveNote(id: string, title: string) {
  await db.insert(notes).values({ id, title }).onConflictDoUpdate({ target: notes.id, set: { title } })
}

export async function noteById(id: string) {
  return db.query.notes.findFirst({ where: eq(notes.id, id) })
}
