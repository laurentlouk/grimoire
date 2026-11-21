import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator'
import migrations from '../drizzle/migrations'
import { db } from '../db/client'

export default function RootLayout() {
  const { success } = useMigrations(db, migrations)
  return success ? null : null
}
