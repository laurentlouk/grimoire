import { Route as ItemsRoute } from './routes/items'

const ItemsRouteWithChildren = ItemsRoute.update({
  id: '/items',
  path: '/items',
} as any)

export interface FileRoutesByFullPath {
  '/items': typeof ItemsRoute
}
