import { config } from './config'

export * from './schema'

export function connect() {
  return config()
}
