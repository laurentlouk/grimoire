import { db } from './db/client'
import { users } from './db/schema'
import { findUser } from './users'

test('finds a user', async () => {
  await db.insert(users).values({ email: 'canary-dz-3' })
  await findUser()
})
