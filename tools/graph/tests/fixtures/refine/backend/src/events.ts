import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

// a user's events, the newest first
const TABLE = `${process.env.STAGE}-shop-event`

export async function eventsOf(doc: DynamoDBDocumentClient, ownerId: string) {
  return doc.send(new QueryCommand({ TableName: TABLE, IndexName: 'ByOwner', KeyConditionExpression: 'ownerId = :o', ExpressionAttributeValues: { ':o': ownerId }, ScanIndexForward: false }))
}
