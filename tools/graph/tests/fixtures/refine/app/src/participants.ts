// Who takes part in an event: the rows of event_participants whose event_id is the event's id.
export function participantsOf(rows: { event_id: string; user_id: string }[], eventId: string) {
  return rows.filter((p) => p.event_id === eventId).map((p) => p.user_id)
}
