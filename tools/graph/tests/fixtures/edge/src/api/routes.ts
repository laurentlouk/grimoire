import { createSession } from '../auth/session'

export function register(app: any) {
  app.post('/login', createSession)
}
