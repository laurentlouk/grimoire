CREATE TABLE events (
  id text PRIMARY KEY NOT NULL,
  owner_id text NOT NULL,
  title text NOT NULL,
  starts_at integer
);
CREATE TABLE event_participants (
  event_id text NOT NULL,
  user_id text NOT NULL
);
CREATE INDEX event_participants_event_idx ON event_participants (event_id);
