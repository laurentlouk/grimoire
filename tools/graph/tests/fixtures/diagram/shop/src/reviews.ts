// a review is keyed by its product: productRef holds the products table's id
export const reviewsOfProduct = (productRef: string) => ({ TableName: 'reviews', KeyConditionExpression: 'productRef = :p', ExpressionAttributeValues: { ':p': productRef } })
// the owner of a review is a user of the SQL store: ownerId holds users.id
export const reviewsOfOwner = (ownerId: number) => ({ TableName: 'reviews', IndexName: 'ByOwner', KeyConditionExpression: 'ownerId = :o', ExpressionAttributeValues: { ':o': ownerId } })
// a cart line belongs to its cart: cart_items.cartId holds carts.cartId
export const linesOfCart = (cartId: string) => ({ TableName: 'cart_items', KeyConditionExpression: 'cartId = :c', ExpressionAttributeValues: { ':c': cartId } })
