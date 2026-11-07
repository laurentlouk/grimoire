CREATE OR REPLACE VIEW order_totals AS
  SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id;
