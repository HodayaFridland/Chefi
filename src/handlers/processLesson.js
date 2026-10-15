'use strict';

/**
 * processLesson.js  (Lambda handler)
 * ----------------------------------
 * Triggered when a lesson file is created under incoming/ in the raw S3 bucket.
 *
 * For each uploaded file:
 *   1. download + parse + compute metrics (the pure lib functions);
 *   2. store the lesson's facts in DynamoDB (idempotent by lesson_id);
 *   3. replay the student from their immutable SEED + all stored lessons,
 *      so the state is always correct regardless of upload order;
 *   4. store the new student STATE and one AUDIT record per lesson.
 *
 * The same pure functions are exercised by `npm run local`, so what we verified
 * offline is exactly what runs here.
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const { parseLesson } = require('../lib/parse');
const { computeMetrics } = require('../lib/metrics');
const { replayStudent } = require('../lib/state');
const { loadRules } = require('../lib/config');
const ddb = require('../lib/ddb');
const log = require('../lib/logger');

const s3 = new S3Client({});

// The state fields we persist. This deliberately excludes the personal-data
// fields carried on the seed record, so PII stays only in the SEED item.
function stateFields(state) {
  return {
    student_id: state.student_id,
    program: state.program,
    lessons_completed: state.lessons_completed,
    review_count: state.review_count,
    next_lesson_type: state.next_lesson_type,
    status: state.status,
    final_score: state.final_score ?? null,
  };
}

exports.handler = async (event) => {
  const rules = await loadRules();

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    // S3 keys arrive URL-encoded.
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    await processOne(bucket, key, rules); // throw on error -> Lambda retry / DLQ (L2)
  }
};

async function processOne(bucket, key, rules) {
  // 1. Download and compute.
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const content = await obj.Body.transformToString();
  const { headers, rows } = parseLesson(content);
  const metrics = computeMetrics({ headers, rows });

  const studentId = headers.student_id;
  const pk = ddb.studentPk(studentId);

  // 2. Store this lesson's facts. Keyed by lesson_id so a retry overwrites.
  await ddb.putItem({
    pk,
    sk: `LESSON#${headers.lesson_id}`,
    type: 'LESSON',
    lesson_id: headers.lesson_id,
    student_id: studentId,
    car_id: headers.car_id,
    lesson_type: headers.lesson_type,
    started_at: headers.started_at,
    uploaded_at: headers.uploaded_at,
    metrics,
  });

  // 3. Replay from the immutable seed + every stored lesson for this student.
  const seed = await ddb.getItem(pk, 'SEED');
  if (!seed) {
    log.warn('no seed for student; lesson stored but state not updated', {
      student_id: studentId,
      lesson_id: headers.lesson_id,
    });
    return;
  }

  const lessonItems = await ddb.queryByPrefix(pk, 'LESSON#');
  const lessons = lessonItems.map((i) => ({
    lesson_id: i.lesson_id,
    lesson_type: i.lesson_type,
    started_at: i.started_at,
    metrics: i.metrics,
  }));

  const { state, audits } = replayStudent(seed, lessons, rules);

  // 4. Persist the new state and one audit record per lesson (no PII in either).
  const now = new Date().toISOString();

  const auditItems = audits.map((a) => ({
    pk,
    sk: `AUDIT#${a.lesson_id}`,
    type: 'AUDIT',
    lesson_id: a.lesson_id,
    student_id: studentId,
    started_at: a.started_at,
    lesson_type: a.lesson_type,
    rules_version: a.rules_version,
    evaluated_result: a.evaluated_result,
    result: a.result,
    reason: a.reason,
    matched: a.matched,
    metrics: a.metrics,
    state_before: stateFields(a.state_before),
    state_after: stateFields(a.state_after),
    state_changed: a.state_changed,
    evaluated_at: now,
  }));

  await ddb.putItem({ pk, sk: 'STATE', type: 'STATE', ...stateFields(state), updated_at: now });
  await ddb.putMany(auditItems);

  const thisResult = audits.find((a) => a.lesson_id === headers.lesson_id);
  log.info('processed lesson', {
    lesson_id: headers.lesson_id,
    student_id: studentId,
    result: thisResult ? thisResult.result : null,
    lessons_completed: state.lessons_completed,
    status: state.status,
  });
}
