import { Store } from '../auth/session'

export function handle(store: Store, id: string) {
  return store.load(id)
}
