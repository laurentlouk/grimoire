-- +goose Up
ALTER TABLE accounts ADD COLUMN email text;

-- +goose Down
ALTER TABLE accounts DROP COLUMN email;
