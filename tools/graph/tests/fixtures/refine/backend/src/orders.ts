import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'

export interface OrderItem { orderId: string; status: string; total: number }

const stage = process.env.STAGE

export async function saveOrder(doc: DynamoDBDocumentClient, order: OrderItem): Promise<void> {
  const table = `${stage}-shop-order`
  await doc.send(new PutCommand({ TableName: table, Item: order }))
}
