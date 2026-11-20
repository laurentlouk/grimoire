import { Session, Store } from './session'

export class MemoryStore implements Store {
  load(id: string): Session | null {
    return null
  }
}

export class CachedStore extends MemoryStore {
  load(id: string): Session | null {
    return super.load(id)
  }
}
