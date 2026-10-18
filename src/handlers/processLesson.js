'use strict';

// Lambda handler: triggered when a lesson file is created under incoming/ in the raw
// bucket. For each file: parse + compute metrics, store the lesson, then replay the
// student from their SEED + all stored lessons and store the new STATE and AUDIT records.

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const { parseLesson } = require('../lib/parse');
const { computeMetrics } = require('../lib/metrics');
const { replayStudent } = require('../lib/state');
const { loadRules } = require('../lib/config');
const ddb = require('../lib/ddb');
const log = require('../lib/logger');

const s3 = new S3Client({});

// Fields we persist in STATE/AUDIT — excludes the PII carried on the SEED record.
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
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    await processOne(bucket, key, rules); // throw on error -> Lambda retry / DLQ (L2)
  }
};

async function processOne(bucket, key, rules) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const content = await obj.Body.transformToString();
  const { headers, rows } = parseLesson(content);
  const metrics = computeMetrics({ headers, rows });

  const studentId = headers.student_id;
  const pk = ddb.studentPk(studentId);

  // Store this lesson's facts (keyed by lesson_id so a retry overwrites).
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
