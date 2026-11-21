import authConfig from '../config/auth.config'

export function ttl() {
  return (authConfig() as AuthConfig)
    .expiresIn
}
