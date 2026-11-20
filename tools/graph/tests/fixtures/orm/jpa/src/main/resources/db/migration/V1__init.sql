CREATE TABLE customer (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(200) NOT NULL UNIQUE,
  display_name VARCHAR(80),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE purchase_order (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(32) NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES customer (id),
  total NUMERIC(10, 2),
  created_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX ux_order_number ON purchase_order (order_number);
