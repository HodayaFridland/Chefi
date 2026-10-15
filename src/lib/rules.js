'use strict';

/**
 * rules.js
 * --------
 * The rules engine (section 6). It is deliberately generic and data-driven:
 * the thresholds live in a versioned config object (e.g. rules_v1.json), never
 * in this code. That means switching to rules v2 later is a config change, not
 * a code change.
 *
 * A single condition looks like: { "metric": "harsh_brake_count", "op": ">=", "value": 6 }
 * The config groups conditions into `fail_if_any` and `review_if_any`.
 */

// The comparison operators a condition may use. Kept tiny and explicit so a
// config can never ask us to run arbitrary code.
const OPERATORS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/**
 * Is a single condition true for these metrics?
 * @param {object} metrics - the computed lesson metrics.
 * @param {{metric: string, op: string, value: number}} condition
 * @returns {boolean}
 */
function checkCondition(metrics, condition) {
  const op = OPERATORS[condition.op];
  if (!op) throw new Error(`Unknown operator in rules: ${condition.op}`);
  const actual = metrics[condition.metric];
  if (actual === undefined) throw new Error(`Unknown metric in rules: ${condition.metric}`);
  return op(actual, condition.value);
}

/**
 * Evaluate the metrics against the rules, in the order required by section 6:
 *   1. duration below min_duration_min            -> INVALID
 *   2. any condition in fail_if_any is true       -> FAIL
 *   3. otherwise any condition in review_if_any    -> REVIEW
 *   4. otherwise                                   -> PASS
 *
 * @param {object} metrics - output of computeMetrics().
 * @param {object} rules - the parsed rules config (rules_v1.json).
 * @returns {{result: string, rules_version: string, reason: string, matched: object|null}}
 *          `matched` is the condition that decided a FAIL/REVIEW, for the audit trail.
 */
function evaluate(metrics, rules) {
  const rules_version = rules.version;

  if (metrics.duration_min < rules.min_duration_min) {
    return {
      result: 'INVALID',
      rules_version,
      reason: `duration_min ${metrics.duration_min} < min_duration_min ${rules.min_duration_min}`,
      matched: null,
    };
  }

  const failed = (rules.fail_if_any || []).find((c) => checkCondition(metrics, c));
  if (failed) {
    return {
      result: 'FAIL',
      rules_version,
      reason: `fail_if_any: ${failed.metric} ${failed.op} ${failed.value}`,
      matched: failed,
    };
  }

  const review = (rules.review_if_any || []).find((c) => checkCondition(metrics, c));
  if (review) {
    return {
      result: 'REVIEW',
      rules_version,
      reason: `review_if_any: ${review.metric} ${review.op} ${review.value}`,
      matched: review,
    };
  }

  return {
    result: 'PASS',
    rules_version,
    reason: 'no fail or review condition matched',
    matched: null,
  };
}

module.exports = { evaluate, checkCondition, OPERATORS };
