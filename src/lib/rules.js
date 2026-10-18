'use strict';

// Rules engine (section 6). Thresholds come from versioned config, not from code.

const OPERATORS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function checkCondition(metrics, condition) {
  const op = OPERATORS[condition.op];
  if (!op) throw new Error(`Unknown operator in rules: ${condition.op}`);
  const actual = metrics[condition.metric];
  if (actual === undefined) throw new Error(`Unknown metric in rules: ${condition.metric}`);
  return op(actual, condition.value);
}

/**
 * Order: INVALID (duration < min) -> FAIL (any fail_if_any) -> REVIEW (any
 * review_if_any) -> PASS. `matched` is the deciding condition, for the audit trail.
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

  return { result: 'PASS', rules_version, reason: 'no fail or review condition matched', matched: null };
}

module.exports = { evaluate, checkCondition, OPERATORS };
