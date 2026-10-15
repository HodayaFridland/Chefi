'use strict';

/**
 * state.js
 * --------
 * Student program state and the transitions from section 7.
 *
 * The public entry point is replayStudent(): given a student's starting state
 * and the full list of their lessons, it replays them in started_at order and
 * returns the final state plus one audit record per lesson.
 *
 * Why replay instead of updating incrementally?
 *  - It is a pure function of (start state, lessons, rules), so it is easy to
 *    test and reason about.
 *  - It is order-independent: lessons can arrive in any order; we always sort
 *    by started_at before applying. This already satisfies section 7 and makes
 *    late/out-of-order files (Level 2) a non-issue for correctness.
 *  - Re-running it is idempotent, so reprocessing a student never double-counts.
 *
 * It assumes the lesson list is already de-duplicated by lesson_id (a retried
 * upload of the same lesson must appear once). The caller does that dedup.
 */

const { evaluate } = require('./rules');

/**
 * Coerce a raw student record (e.g. straight from students.csv, all strings)
 * into a state object with the right types. Does not mutate the input.
 */
function normalizeStartState(raw) {
  return {
    ...raw,
    lessons_completed: Number(raw.lessons_completed) || 0,
    review_count: Number(raw.review_count) || 0,
    // These stay as-is (already strings): program, status, next_lesson_type.
    // final_score may not exist yet; leave it undefined until completion.
  };
}

/**
 * Apply the FAIL effect (section 7) and return the new state.
 *  - STANDARD: move to EXTENDED, reset review_count, keep lessons_completed.
 *  - EXTENDED: status becomes INSTRUCTOR_REVIEW.
 */
function applyFail(state) {
  if (state.program === 'STANDARD') {
    return { ...state, program: 'EXTENDED', review_count: 0 };
  }
  return { ...state, status: 'INSTRUCTOR_REVIEW' };
}

/**
 * Replay all of a student's lessons and return the final state + audit trail.
 *
 * @param {object} startState - the student's starting record (from students.csv).
 * @param {object[]} lessons - each: { lesson_id, lesson_type, started_at, metrics }.
 *        `metrics` is the output of computeMetrics() and includes lesson_score.
 * @param {object} rules - the parsed rules config (has programs + thresholds).
 * @returns {{ state: object, audits: object[] }}
 */
function replayStudent(startState, lessons, rules) {
  let state = normalizeStartState(startState);
  const audits = [];

  // Running pool for final_score: the REGULAR lessons that PASSED in our system.
  let regularPassSum = 0;
  let regularPassCount = 0;

  // started_at is ISO-8601 UTC, so string order == chronological order.
  const ordered = [...lessons].sort((a, b) =>
    a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0
  );

  for (const lesson of ordered) {
    const evaluation = evaluate(lesson.metrics, rules);
    const stateBefore = { ...state };

    let result = evaluation.result; // the effective result (REVIEW may become FAIL)
    let reason = evaluation.reason;
    let stateChanged = true;

    if (state.status !== 'ACTIVE') {
      // Recorded and evaluated, but no state change once not ACTIVE.
      reason = `student status is ${state.status}: recorded, no state change`;
      stateChanged = false;
    } else {
      const program = rules.programs[state.program];

      if (result === 'INVALID') {
        stateChanged = false; // no change
      } else if (result === 'REVIEW') {
        const newReviewCount = state.review_count + 1;
        if (newReviewCount > program.max_reviews) {
          // Too many reviews: treat this lesson as a FAIL instead.
          result = 'FAIL';
          reason = `review_count would exceed max_reviews (${program.max_reviews}); treated as FAIL`;
          state = applyFail(state);
        } else {
          state = { ...state, review_count: newReviewCount, next_lesson_type: 'PRACTICE' };
        }
      } else if (result === 'FAIL') {
        state = applyFail(state);
      } else if (result === 'PASS') {
        // Only a REGULAR pass advances the program and feeds final_score.
        if (lesson.lesson_type === 'REGULAR') {
          regularPassSum += lesson.metrics.lesson_score;
          regularPassCount += 1;
          state = { ...state, lessons_completed: state.lessons_completed + 1 };
        }
        state = { ...state, next_lesson_type: 'REGULAR' };

        // Completion: reaching the program length finishes the program.
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
      evaluated_result: evaluation.result, // what the rules engine said
      result, // what we actually applied (REVIEW can become FAIL)
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
