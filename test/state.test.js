'use strict';

const fs = require('fs');
const path = require('path');
const { replayStudent } = require('../src/lib/state');

const rules = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'sample_data', 'rules_v1.json'), 'utf8')
);

// Metrics crafted to produce a given result under rules_v1.
function metricsFor(result, lessonScore = 90) {
  const base = {
    duration_min: 20,
    pct_time_over_limit: 0,
    harsh_brake_count: 0,
    harsh_accel_count: 0,
    sharp_turn_count: 0,
    max_lateral_g: 0.1,
    lesson_score: lessonScore,
  };
  if (result === 'INVALID') return { ...base, duration_min: 10 };
  if (result === 'FAIL') return { ...base, max_lateral_g: 0.7 };
  if (result === 'REVIEW') return { ...base, harsh_brake_count: 3 };
  return base; // PASS
}

// Build a lesson. Lessons are numbered so started_at increases with `order`.
function lesson(id, type, result, { order = 1, score = 90 } = {}) {
  const started_at = `2026-10-${String(order).padStart(2, '0')}T08:00:00Z`;
  return { lesson_id: id, lesson_type: type, started_at, metrics: metricsFor(result, score) };
}

// A fresh STANDARD student, mid-program.
function student(overrides = {}) {
  return {
    student_id: 'S-TEST',
    program: 'STANDARD',
    lessons_completed: 5,
    review_count: 0,
    next_lesson_type: 'REGULAR',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('replayStudent', () => {
  test('a REGULAR pass advances the program and expects REGULAR next', () => {
    const { state } = replayStudent(student(), [lesson('L1', 'REGULAR', 'PASS')], rules);
    expect(state.lessons_completed).toBe(6);
    expect(state.next_lesson_type).toBe('REGULAR');
  });

  test('a PRACTICE pass does not advance the program', () => {
    const { state } = replayStudent(student(), [lesson('L1', 'PRACTICE', 'PASS')], rules);
    expect(state.lessons_completed).toBe(5);
    expect(state.next_lesson_type).toBe('REGULAR');
  });

  test('a review increments review_count and expects PRACTICE next', () => {
    const { state } = replayStudent(student(), [lesson('L1', 'REGULAR', 'REVIEW')], rules);
    expect(state.review_count).toBe(1);
    expect(state.next_lesson_type).toBe('PRACTICE');
  });

  test('a review beyond max_reviews is treated as FAIL', () => {
    // max_reviews is 2. Start at 2 so the next review would be the 3rd -> FAIL.
    const { state, audits } = replayStudent(
      student({ review_count: 2 }),
      [lesson('L1', 'REGULAR', 'REVIEW')],
      rules
    );
    expect(audits[0].evaluated_result).toBe('REVIEW');
    expect(audits[0].result).toBe('FAIL');
    // FAIL in STANDARD -> EXTENDED, review reset.
    expect(state.program).toBe('EXTENDED');
    expect(state.review_count).toBe(0);
  });

  test('FAIL in STANDARD moves to EXTENDED and keeps lessons_completed', () => {
    const { state } = replayStudent(student({ lessons_completed: 7 }), [lesson('L1', 'REGULAR', 'FAIL')], rules);
    expect(state.program).toBe('EXTENDED');
    expect(state.review_count).toBe(0);
    expect(state.lessons_completed).toBe(7);
    expect(state.status).toBe('ACTIVE');
  });

  test('FAIL in EXTENDED sends the student to INSTRUCTOR_REVIEW', () => {
    const { state } = replayStudent(
      student({ program: 'EXTENDED' }),
      [lesson('L1', 'REGULAR', 'FAIL')],
      rules
    );
    expect(state.status).toBe('INSTRUCTOR_REVIEW');
  });

  test('INVALID changes nothing', () => {
    const before = student({ lessons_completed: 5, review_count: 1 });
    const { state, audits } = replayStudent(before, [lesson('L1', 'REGULAR', 'INVALID')], rules);
    expect(state.lessons_completed).toBe(5);
    expect(state.review_count).toBe(1);
    expect(audits[0].state_changed).toBe(false);
  });

  test('reaching the program length completes with an averaged final_score', () => {
    const { state } = replayStudent(
      student({ lessons_completed: 10 }),
      [
        lesson('L1', 'REGULAR', 'PASS', { order: 1, score: 80 }),
        lesson('L2', 'REGULAR', 'PASS', { order: 2, score: 90 }), // 12th lesson -> done
      ],
      rules
    );
    expect(state.status).toBe('COMPLETED');
    expect(state.lessons_completed).toBe(12);
    expect(state.final_score).toBeCloseTo(85, 10); // (80 + 90) / 2
  });

  test('once not ACTIVE, later lessons are recorded but do not change state', () => {
    const { state, audits } = replayStudent(
      student({ status: 'COMPLETED', lessons_completed: 12 }),
      [lesson('L1', 'REGULAR', 'PASS')],
      rules
    );
    expect(state.lessons_completed).toBe(12); // unchanged
    expect(audits).toHaveLength(1); // still recorded
    expect(audits[0].state_changed).toBe(false);
  });

  test('result is independent of the order lessons are supplied in', () => {
    const lessons = [
      lesson('L3', 'REGULAR', 'PASS', { order: 3 }),
      lesson('L1', 'REGULAR', 'PASS', { order: 1 }),
      lesson('L2', 'REGULAR', 'REVIEW', { order: 2 }),
    ];
    const forward = replayStudent(student(), lessons, rules).state;
    const shuffled = replayStudent(student(), [...lessons].reverse(), rules).state;
    expect(shuffled).toEqual(forward);
  });
});
