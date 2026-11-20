export interface Store {
  load(id: string): Session | null
}

export class Session {
  constructor(public id: string, public user: string) {}
  refresh(ttl: number): Session {
    return new Session(this.id, this.user)
  }
}

export function createSession(user: string): Session {
  return new Session(newId(), user)
}

function newId(): string {
  return Math.random().toString(36)
}
