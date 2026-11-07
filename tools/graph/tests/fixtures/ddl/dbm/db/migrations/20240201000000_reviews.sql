-- migrate:up
CREATE TABLE reviews (
  book_id bigint NOT NULL REFERENCES books (id),
  reviewer varchar(80) NOT NULL,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  PRIMARY KEY (book_id, reviewer)
);
ALTER TABLE books ADD COLUMN published date;

-- migrate:down
ALTER TABLE books DROP COLUMN published;
DROP TABLE reviews;
