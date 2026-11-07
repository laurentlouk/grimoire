import { defineConfig } from 'drizzle-kit'

// Pushed to the database, never generated: no migrations folder exists.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  casing: 'snake_case',
})
