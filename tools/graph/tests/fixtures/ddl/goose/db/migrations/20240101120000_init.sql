-- +goose Up
CREATE TABLE accounts (id serial PRIMARY KEY, name text NOT NULL);
-- +goose StatementBegin
CREATE FUNCTION touch() RETURNS trigger AS $$
BEGIN
  NEW.name := trim(NEW.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION touch();
DROP TABLE accounts;
