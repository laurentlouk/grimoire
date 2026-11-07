-- migrate:up
CREATE TYPE mood AS ENUM ('calm', 'busy');

CREATE TABLE authors (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL,
  mood mood NOT NULL DEFAULT 'calm',
  joined timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE books (
  id bigserial PRIMARY KEY,
  author_id int NOT NULL REFERENCES authors (id) ON DELETE CASCADE,
  title text NOT NULL,
  pages int DEFAULT -1,
  tags text[] DEFAULT '{}'
);

CREATE UNIQUE INDEX books_author_title ON books (author_id, lower(title));

-- migrate:down
DROP TABLE books;
DROP TABLE authors;
DROP TYPE mood;
