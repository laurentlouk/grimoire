CREATE TABLE posts (id serial PRIMARY KEY, user_id int REFERENCES users (id));
