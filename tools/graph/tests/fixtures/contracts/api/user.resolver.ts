import { Resolver, Query, ResolveField, ObjectType } from '@nestjs/graphql'

@ObjectType()
export class User {
  id: string
}

@Resolver(() => User)
export class UserResolver {
  @Query(() => User, { name: 'me' })
  current() {
    return null
  }

  @ResolveField()
  posts() {
    return []
  }
}
