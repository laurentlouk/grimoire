CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id),
  body TEXT
);
CREATE INDEX posts_user_id_idx ON posts (user_id);
