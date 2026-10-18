'use strict';

// DynamoDB access (SDK v3 Document client). One table keyed by (pk, sk):
//   SEED   STUDENT#<id> / SEED               immutable starting record
//   STATE  STUDENT#<id> / STATE              current computed state
//   LESSON STUDENT#<id> / LESSON#<lesson_id> per-lesson metrics (idempotent by lesson_id)
//   AUDIT  STUDENT#<id> / AUDIT#<lesson_id>  per-lesson decision + state change

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.TABLE_NAME;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const studentPk = (studentId) => `STUDENT#${studentId}`;

async function getItem(pk, sk) {
  const out = await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }));
  return out.Item || null;
}

async function putItem(item) {
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
}

async function queryByPrefix(pk, skPrefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': pk, ':p': skPrefix },
        ExclusiveStartKey,
      })
    );
    items.push(...(out.Items || []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// BatchWrite in chunks of 25 (DynamoDB's limit).
async function putMany(items) {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await doc.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) },
      })
    );
  }
}

module.exports = { getItem, putItem, queryByPrefix, putMany, studentPk };
