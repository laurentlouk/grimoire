import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { OrderView } from './types'

const TABLE = process.env.ORDERS_TABLE

export async function saveOrder(doc: DynamoDBDocumentClient, order: OrderView): Promise<void> {
  await doc.send(new PutCommand({ TableName: TABLE, Item: order }))
}
