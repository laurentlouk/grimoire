import { open } from '@op-engineering/op-sqlite'

const raw = open({ name: 'app.db' })

export async function titles() {
  return raw.executeAsync('SELECT id, title FROM notes ORDER BY created_at')
}
