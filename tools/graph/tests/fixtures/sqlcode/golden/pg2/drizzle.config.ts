import { defineConfig } from 'drizzle-kit'
export default defineConfig({ dialect: 'postgresql', schema: './src/*.ts', out: './drizzle', casing: 'snake_case' })
