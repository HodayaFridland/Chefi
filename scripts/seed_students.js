'use strict';

/**
 * seed_students.js
 * ----------------
 * One-time load of students.csv into DynamoDB. Writes, per student:
 *   - a SEED item: the immutable starting record (includes personal data),
 *     which replay always starts from;
 *   - a STATE item: the initial current state (logic fields only, no PII).
 *
 * Usage (after `terraform apply`):
 *   TABLE_NAME=$(terraform -chdir=terraform output -raw table_name) \
 *     node scripts/seed_students.js
 */

const fs = require('fs');
const path = require('path');

if (!process.env.TABLE_NAME) {
  console.error('Set TABLE_NAME (e.g. from `terraform output -raw table_name`).');
  process.exit(1);
}

const { parseStudents } = require('../src/lib/students');
const ddb = require('../src/lib/ddb'); // reads TABLE_NAME from env on load

const STUDENTS_CSV = path.join(__dirname, '..', 'sample_data', 'students.csv');

async function main() {
  const students = parseStudents(fs.readFileSync(STUDENTS_CSV, 'utf8'));

  for (const s of students) {
    const pk = ddb.studentPk(s.student_id);

    // SEED: full record, kept as-is (DynamoDB encrypts it at rest).
    await ddb.putItem({ pk, sk: 'SEED', type: 'SEED', ...s });

    // STATE: initial current state, logic fields only (no personal data).
    await ddb.putItem({
      pk,
      sk: 'STATE',
      type: 'STATE',
      student_id: s.student_id,
      program: s.program,
      lessons_completed: Number(s.lessons_completed) || 0,
      review_count: Number(s.review_count) || 0,
      next_lesson_type: s.next_lesson_type,
      status: s.status,
      final_score: null,
      updated_at: new Date().toISOString(),
    });

    console.log(`seeded ${s.student_id}`);
  }
  console.log(`done: ${students.length} students`);
}

main().catch((err) => {
  console.error('seed failed:', err.message);
  process.exit(1);
});
