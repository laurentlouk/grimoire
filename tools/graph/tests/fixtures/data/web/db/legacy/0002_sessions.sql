CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  expires_at TEXT
);
