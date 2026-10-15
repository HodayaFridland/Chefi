'use strict';

/**
 * ddb.js
 * ------
 * Thin wrapper around DynamoDB using the AWS SDK v3 Document client, which maps
 * plain JS objects to/from DynamoDB for us. One table, keyed by (pk, sk):
 *
 *   SEED   pk=STUDENT#<id>  sk=SEED              immutable starting record (from CSV)
 *   STATE  pk=STUDENT#<id>  sk=STATE             current computed state (overwritten)
 *   LESSON pk=STUDENT#<id>  sk=LESSON#<lesson_id> per-lesson metrics (facts)
 *   AUDIT  pk=STUDENT#<id>  sk=AUDIT#<lesson_id>  per-lesson decision + state change
 *
 * Keying LESSON/AUDIT by lesson_id makes retries idempotent: re-processing the
 * same lesson overwrites the same item instead of creating a duplicate.
 */

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

// Return all items for one student whose sk starts with the given prefix.
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

// Write many items in batches of 25 (DynamoDB's BatchWrite limit).
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
