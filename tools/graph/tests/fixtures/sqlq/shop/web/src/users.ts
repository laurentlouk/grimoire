import { sql } from './db'

export async function findUser(email: string) {
  const rows = await sql`
    SELECT u.id, u.email, u.display_name
    FROM users u
    WHERE u.email = ${email}
  `
  return rows[0]
}

export async function upsertUser(email: string, name: string) {
  return sql`
    INSERT INTO users (email, display_name)
    VALUES (${email}, ${name})
    ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
  `
}

export async function recentOrders(userId: number, table: string) {
  const own = await sql`
    SELECT o.id, o.total, o.created_at
    FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE u.id = ${userId}
    ORDER BY o.created_at DESC
  `
  // a table named by code is a parameter, never a table
  const other = await sql.unsafe(`SELECT * FROM ${table} WHERE id = $1`, [userId])
  return [own, other]
}
