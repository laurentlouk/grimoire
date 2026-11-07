package main

import "database/sql"

type Repo struct{ db *sql.DB }

const pendingOrders = `
SELECT o.id, o.user_id, o.total::numeric
FROM orders o
WHERE o.status = $1
ORDER BY o.created_at`

func (r *Repo) Pending() (*sql.Rows, error) {
	return r.db.Query(pendingOrders, "pending")
}

func (r *Repo) MarkShipped(id int) error {
	_, err := r.db.Exec("UPDATE orders SET status = 'shipped', shipped_at = now() WHERE id = $1", id)
	return err
}

func (r *Repo) AddLine(orderID, productID, qty int) error {
	_, err := r.db.Exec(`INSERT INTO order_lines (order_id, product_id, quantity)
		VALUES ($1, $2, $3)
		ON CONFLICT (order_id, product_id) DO UPDATE SET quantity = order_lines.quantity + EXCLUDED.quantity`, orderID, productID, qty)
	return err
}

func (r *Repo) Lines(orderID int) (*sql.Rows, error) {
	return r.db.Query(`SELECT l.product_id, l.quantity, p.name
		FROM order_lines l JOIN products p ON p.id = l.product_id
		WHERE l.order_id = $1`, orderID)
}
