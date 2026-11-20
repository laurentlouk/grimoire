CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
CREATE TABLE coupons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  coupon_id INTEGER,
  total INTEGER NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_user_id INTEGER,
  order_id INTEGER,
  action TEXT NOT NULL
);
