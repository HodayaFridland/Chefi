'use strict';

/**
 * show_results.js
 * ---------------
 * Reads the deployed DynamoDB table and prints each student's current STATE and
 * each lesson's AUDIT result. Use it after uploading to confirm the live results
 * match the local run (`npm run local`).
 *
 * Usage (after deploy + seed + upload):
 *   TABLE_NAME=$(terraform -chdir=terraform output -raw table_name) \
 *     node scripts/show_results.js
 */

if (!process.env.TABLE_NAME) {
  console.error('Set TABLE_NAME (e.g. from `terraform output -raw table_name`).');
  process.exit(1);
}

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const r = (n) => (n === null || n === undefined ? '–' : Number(Number(n).toFixed(2)));

async function scanAll() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await doc.send(
      new ScanCommand({ TableName: process.env.TABLE_NAME, ExclusiveStartKey })
    );
    items.push(...(out.Items || []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  const items = await scanAll();

  const audits = items
    .filter((i) => i.type === 'AUDIT')
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));

  const states = items
    .filter((i) => i.type === 'STATE')
    .sort((a, b) => (a.student_id < b.student_id ? -1 : 1));

  console.log('\nLESSON RESULTS (from DynamoDB)');
  console.log('lesson   student  type      result    score');
  console.log('-------------------------------------------------');
  for (const a of audits) {
    console.log(
      [
        a.lesson_id.padEnd(8),
        a.student_id.padEnd(8),
        a.lesson_type.padEnd(9),
        a.result.padEnd(9),
        String(r(a.metrics && a.metrics.lesson_score)).padStart(6),
      ].join(' ')
    );
  }

  console.log('\nFINAL STUDENT STATE (from DynamoDB)');
  console.log('student  program   completed  reviews  status             final_score');
  console.log('----------------------------------------------------------------------');
  for (const s of states) {
    console.log(
      [
        s.student_id.padEnd(8),
        String(s.program).padEnd(9),
        String(s.lessons_completed).padStart(9),
        String(s.review_count).padStart(7),
        String(s.status).padEnd(18),
        String(r(s.final_score)).padStart(11),
      ].join(' ')
    );
  }
  console.log('');
}

main().catch((err) => {
  console.error('failed:', err.message);
  process.exit(1);
});
