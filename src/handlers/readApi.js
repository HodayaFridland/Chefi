'use strict';

/**
 * readApi.js  (LEVEL 2 — instructor read API)
 * -------------------------------------------
 * A single Lambda behind a Lambda Function URL (a public HTTPS endpoint, no API
 * Gateway needed). Two read-only routes:
 *
 *   GET /students/{id}  -> the student's current state + their lesson results
 *   GET /lessons/{id}   -> one lesson's metrics, result and state change
 *
 * Auth: a shared key passed as ?key=... and checked against the API_KEY env var
 * (so the endpoint is authenticated, as Level 2 requires). Personal data is
 * never returned — only the STATE and AUDIT items, which hold no PII.
 *
 * This file is intentionally self-contained so the Level 1 code stays untouched.
 */

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
  // Simple shared-key auth.
  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!API_KEY || key !== API_KEY) {
    return json(401, { error: 'unauthorized: add ?key=<api key>' });
  }

  const path = (event.rawPath || '/').replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean); // e.g. ["students", "S-001"]

  try {
    if (parts[0] === 'students' && parts[1]) return await getStudent(parts[1]);
    if (parts[0] === 'lessons' && parts[1]) return await getLesson(parts[1]);
    return json(404, { error: 'not found. Use /students/{id} or /lessons/{id}' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// GET /students/{id}: the STATE item plus a summary of the student's lessons.
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

// GET /lessons/{id}: the AUDIT record for one lesson (metrics, result, change).
// A Scan is fine at this scale; a GSI on lesson_id would scale this later.
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
