import { authRouter } from './router'

const auth = initAuth()

export function getSession() {
  return auth.api.getSession()
}

export function viaRouter() {
  return authRouter.getSession()
}
