import { findUser } from './users'

export function listUsers() {
  return []
}

export const resolvers = {
  Query: {
    user: findUser,
    users: () => listUsers(),
    viewer(parent: unknown) {
      return parent
    },
  },
  Mutation: {
    createUser: (_: unknown, args: { name: string }) => args,
  },
}
