import { request as __request } from './core/request'

export class UsersService {
  public static readUserMe() {
    return __request({ method: 'GET', url: '/api/v1/users/me' })
  }

  public static readUserById(id: number) {
    return __request({ method: 'GET', url: `/api/v1/users/${id}` })
  }
}
