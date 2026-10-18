'use strict';

// Student state transitions (section 7). replayStudent() recomputes state from the
// immutable start record + all lessons sorted by started_at, so it is order-independent
// and idempotent. Assumes lessons are already de-duplicated by lesson_id.

const { evaluate } = require('./rules');

function normalizeStartState(raw) {
  return {
    ...raw,
    lessons_completed: Number(raw.lessons_completed) || 0,
    review_count: Number(raw.review_count) || 0,
  };
}

// FAIL: STANDARD -> EXTENDED (reset reviews, keep lessons); EXTENDED -> INSTRUCTOR_REVIEW.
function applyFail(state) {
  if (state.program === 'STANDARD') {
    return { ...state, program: 'EXTENDED', review_count: 0 };
  }
  return { ...state, status: 'INSTRUCTOR_REVIEW' };
}

/**
 * @param {object} startState - the student's starting record (from students.csv).
 * @param {object[]} lessons - each { lesson_id, lesson_type, started_at, metrics }.
 * @param {object} rules - parsed rules config (programs + thresholds).
 * @returns {{ state: object, audits: object[] }}
 */
function replayStudent(startState, lessons, rules) {
  let state = normalizeStartState(startState);
  const audits = [];

  let regularPassSum = 0;
  let regularPassCount = 0;

  const ordered = [...lessons].sort((a, b) =>
    a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0
  );

  for (const lesson of ordered) {
    const evaluation = evaluate(lesson.metrics, rules);
    const stateBefore = { ...state };

    let result = evaluation.result; // effective result (a REVIEW can become FAIL)
    let reason = evaluation.reason;
    let stateChanged = true;

    if (state.status !== 'ACTIVE') {
      reason = `student status is ${state.status}: recorded, no state change`;
      stateChanged = false;
    } else {
      const program = rules.programs[state.program];

      if (result === 'INVALID') {
        stateChanged = false;
      } else if (result === 'REVIEW') {
        const newReviewCount = state.review_count + 1;
        if (newReviewCount > program.max_reviews) {
          result = 'FAIL';
          reason = `review_count would exceed max_reviews (${program.max_reviews}); treated as FAIL`;
          state = applyFail(state);
        } else {
          state = { ...state, review_count: newReviewCount, next_lesson_type: 'PRACTICE' };
        }
      } else if (result === 'FAIL') {
        state = applyFail(state);
      } else if (result === 'PASS') {
        if (lesson.lesson_type === 'REGULAR') {
          regularPassSum += lesson.metrics.lesson_score;
          regularPassCount += 1;
          state = { ...state, lessons_completed: state.lessons_completed + 1 };
        }
        state = { ...state, next_lesson_type: 'REGULAR' };

        const programLength = rules.programs[state.program].lessons;
        if (state.lessons_completed >= programLength) {
          state = {
            ...state,
            status: 'COMPLETED',
            final_score: regularPassCount > 0 ? regularPassSum / regularPassCount : null,
          };
        }
      }
    }

    audits.push({
      lesson_id: lesson.lesson_id,
      student_id: stateBefore.student_id,
      started_at: lesson.started_at,
      lesson_type: lesson.lesson_type,
      rules_version: evaluation.rules_version,
      evaluated_result: evaluation.result,
      result,
      reason,
      matched: evaluation.matched,
      metrics: lesson.metrics,
      state_before: stateBefore,
      state_after: state,
      state_changed: stateChanged,
    });
  }

  return { state, audits };
}

module.exports = { replayStudent, normalizeStartState, applyFail };
