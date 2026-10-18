'use strict';

// Level 2 instructor read API, behind a Lambda Function URL:
//   GET /students/{id}?key=...  -> state + lesson results
//   GET /lessons/{id}?key=...   -> one lesson's metrics, result and state change
// Auth: a shared key (?key=) checked against API_KEY. Only non-PII items are returned.
// Self-contained so Level 1 code stays untouched.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.TABLE_NAME;
const API_KEY = process.env.API_KEY;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}

exports.handler = async (event) => {
  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!API_KEY || key !== API_KEY) return json(401, { error: 'unauthorized: add ?key=<api key>' });

  const parts = (event.rawPath || '/').replace(/\/+$/, '').split('/').filter(Boolean);

  try {
    if (parts[0] === 'students' && parts[1]) return await getStudent(parts[1]);
    if (parts[0] === 'lessons' && parts[1]) return await getLesson(parts[1]);
    return json(404, { error: 'not found. Use /students/{id} or /lessons/{id}' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

async function getStudent(id) {
  const out = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `STUDENT#${id}` },
    })
  );
  const items = out.Items || [];
  const state = items.find((i) => i.type === 'STATE');
  if (!state) return json(404, { error: `student ${id} not found` });

  const lessons = items
    .filter((i) => i.type === 'AUDIT')
    .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
    .map((a) => ({
      lesson_id: a.lesson_id,
      started_at: a.started_at,
      lesson_type: a.lesson_type,
      result: a.result,
      lesson_score: a.metrics && a.metrics.lesson_score,
    }));

  return json(200, { student: state, lessons });
}

// Scan is fine at this scale; a GSI on lesson_id would scale this later.
async function getLesson(id) {
  const out = await doc.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#t = :audit AND lesson_id = :lid',
      ExpressionAttributeNames: { '#t': 'type' },
      ExpressionAttributeValues: { ':audit': 'AUDIT', ':lid': id },
    })
  );
  const item = (out.Items || [])[0];
  if (!item) return json(404, { error: `lesson ${id} not found` });
  return json(200, { lesson: item });
}
