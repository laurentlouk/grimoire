import { createSession } from '../auth/session'

export function login(user: string) {
  return createSession(user)
}
