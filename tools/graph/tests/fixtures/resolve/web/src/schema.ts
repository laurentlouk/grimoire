import { pgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { createContext } from 'react'
import debounce from 'lodash/debounce'

export const posts = pgTable('posts', {}, (t) => ({}))
export const Input = z.object({}).refine((v) => true)
export const Ctx = createContext(() => {})
export const authed = t.procedure.use((opts) => opts)
export const debounced = debounce(() => 1)

export function wire() {
  return [posts, Input, Ctx, authed, debounced]
}
