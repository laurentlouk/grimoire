import { createSession } from '../src/auth/session'

export function testCreate() {
  return createSession('u')
}
