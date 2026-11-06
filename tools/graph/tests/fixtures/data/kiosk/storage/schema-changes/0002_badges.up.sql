CREATE TABLE badges (
  code TEXT PRIMARY KEY,
  holder TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX visits_badge_idx ON visits (badge);
