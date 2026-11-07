// The device keeps its events in SQLite and pushes each one to the backend's table.
export interface EventRow { id: string; owner_id: string; title: string; starts_at: number | null }

export function toBackend(e: EventRow) {
  return { eventId: e.id, ownerId: e.owner_id, title: e.title }
}
