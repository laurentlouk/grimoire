import { request as __request } from './core/request'

export class UsersService {
  public static readUserMe() {
    return __request({ method: 'GET', url: '/api/v1/users/me' })
  }

  public static readItems() {
    return client.get<ItemsResponse, ItemsError>({
      responseType: 'json',
      url: '/api/v1/items/',
    })
  }

  public static createItem() {
    return client.post({ url: '/api/v1/items/' })
  }

  public static readUserById(id: number) {
    return __request({ method: 'GET', url: `/api/v1/users/${id}` })
  }
}
