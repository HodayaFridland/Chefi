'use strict';

/**
 * run_local.js
 * ------------
 * Runs the whole pipeline on the sample data, entirely in memory, with NO AWS.
 *
 *   parse -> compute metrics -> de-duplicate retries -> group by student
 *   -> replay each student (rules + state) -> print results + final states.
 *
 * This is how we verify correctness for free before deploying anything, and it
 * produces the "Results" table for the README. Run it with:  npm run local
 */

const fs = require('fs');
const path = require('path');

const { parseLesson } = require('../src/lib/parse');
const { computeMetrics } = require('../src/lib/metrics');
const { replayStudent } = require('../src/lib/state');
const { parseStudents } = require('../src/lib/students');

const ROOT = path.join(__dirname, '..');
const LESSONS_DIR = path.join(ROOT, 'sample_data', 'lessons');
const STUDENTS_CSV = path.join(ROOT, 'sample_data', 'students.csv');
const RULES_JSON = path.join(ROOT, 'sample_data', 'rules_v1.json');

// Recursively list every .csv file under a directory.
function findCsvFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findCsvFiles(full));
    else if (entry.name.endsWith('.csv')) out.push(full);
  }
  return out;
}

// Round for display only; the stored/compared values keep full precision.
const r = (n, digits = 2) => (n === null || n === undefined ? '' : Number(n.toFixed(digits)));

function main() {
  const rules = JSON.parse(fs.readFileSync(RULES_JSON, 'utf8'));
  const startStates = parseStudents(fs.readFileSync(STUDENTS_CSV, 'utf8'));

  // 1. Parse every file and compute its metrics.
  const parsed = findCsvFiles(LESSONS_DIR).map((file) => {
    const { headers, rows } = parseLesson(fs.readFileSync(file, 'utf8'));
    return {
      lesson_id: headers.lesson_id,
      student_id: headers.student_id,
      lesson_type: headers.lesson_type,
      started_at: headers.started_at,
      uploaded_at: headers.uploaded_at,
      metrics: computeMetrics({ headers, rows }),
    };
  });

  // 2. De-duplicate retries: the same lesson_id can be uploaded twice
  //    (e.g. L-1007 and L-1007_retry1). Keep the latest upload.
  const byId = new Map();
  for (const lesson of parsed) {
    const existing = byId.get(lesson.lesson_id);
    if (!existing || lesson.uploaded_at > existing.uploaded_at) {
      byId.set(lesson.lesson_id, lesson);
    }
  }
  const lessons = [...byId.values()];
  const duplicatesDropped = parsed.length - lessons.length;

  // 3. Group lessons by student.
  const lessonsByStudent = new Map();
  for (const lesson of lessons) {
    if (!lessonsByStudent.has(lesson.student_id)) lessonsByStudent.set(lesson.student_id, []);
    lessonsByStudent.get(lesson.student_id).push(lesson);
  }

  // 4. Replay each student and collect audits.
  const allAudits = [];
  const finalStates = [];
  for (const start of startStates) {
    const studentLessons = lessonsByStudent.get(start.student_id) || [];
    const { state, audits } = replayStudent(start, studentLessons, rules);
    allAudits.push(...audits);
    finalStates.push(state);
  }

  // 5. Print the per-lesson results, in processing (started_at) order.
  allAudits.sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));

  console.log(`\nParsed ${parsed.length} files, ${duplicatesDropped} duplicate upload(s) dropped.\n`);
  console.log('LESSON RESULTS');
  console.log('lesson   student  type      result    score  dur_min  over%  brake accel turn  maxG');
  console.log('-------------------------------------------------------------------------------------');
  for (const a of allAudits) {
    const m = a.metrics;
    const flag = a.result !== a.evaluated_result ? ` (was ${a.evaluated_result})` : '';
    console.log(
      [
        a.lesson_id.padEnd(8),
        a.student_id.padEnd(8),
        a.lesson_type.padEnd(9),
        a.result.padEnd(9),
        String(r(m.lesson_score)).padStart(5),
        String(r(m.duration_min)).padStart(8),
        String(r(m.pct_time_over_limit)).padStart(6),
        String(m.harsh_brake_count).padStart(5),
        String(m.harsh_accel_count).padStart(5),
        String(m.sharp_turn_count).padStart(5),
        String(r(m.max_lateral_g)).padStart(6),
      ].join(' ') + flag
    );
  }

  // 6. Print the final state of every student.
  console.log('\nFINAL STUDENT STATE');
  console.log('student  program   completed  reviews  next       status             final_score');
  console.log('-------------------------------------------------------------------------------------');
  for (const s of finalStates) {
    console.log(
      [
        s.student_id.padEnd(8),
        String(s.program).padEnd(9),
        String(s.lessons_completed).padStart(9),
        String(s.review_count).padStart(7),
        String(s.next_lesson_type).padEnd(10),
        String(s.status).padEnd(18),
        String(r(s.final_score)).padStart(11),
      ].join(' ')
    );
  }
  console.log('');
}

main();
