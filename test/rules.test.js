'use strict';

const fs = require('fs');
const path = require('path');
const { evaluate } = require('../src/lib/rules');

// Load the real rules file the assignment ships with, so the tests exercise
// the actual thresholds we deploy.
const rules = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'sample_data', 'rules_v1.json'), 'utf8')
);

// A metrics object that passes everything; tests tweak one field at a time.
function cleanMetrics(overrides = {}) {
  return {
    duration_min: 20,
    pct_time_over_limit: 0,
    harsh_brake_count: 0,
    harsh_accel_count: 0,
    sharp_turn_count: 0,
    max_lateral_g: 0.1,
    ...overrides,
  };
}

describe('evaluate (rules_v1)', () => {
  test('a clean lesson passes', () => {
    expect(evaluate(cleanMetrics(), rules).result).toBe('PASS');
  });

  test('a too-short lesson is INVALID, checked before anything else', () => {
    // Even with a failing metric, short duration wins.
    const m = cleanMetrics({ duration_min: 10, max_lateral_g: 0.9 });
    expect(evaluate(m, rules).result).toBe('INVALID');
  });

  test('exceeding a fail threshold gives FAIL', () => {
    // max_lateral_g > 0.65 is a fail condition.
    expect(evaluate(cleanMetrics({ max_lateral_g: 0.7 }), rules).result).toBe('FAIL');
  });

  test('FAIL takes precedence over REVIEW', () => {
    // pct_time_over_limit > 15 fails AND > 5 reviews; FAIL must win.
    const m = cleanMetrics({ pct_time_over_limit: 20 });
    const out = evaluate(m, rules);
    expect(out.result).toBe('FAIL');
  });

  test('a review threshold with no fail gives REVIEW', () => {
    // harsh_brake_count >= 3 reviews, but >= 6 would fail.
    expect(evaluate(cleanMetrics({ harsh_brake_count: 3 }), rules).result).toBe('REVIEW');
  });

  test('the result records the rules version and the matched condition', () => {
    const out = evaluate(cleanMetrics({ harsh_brake_count: 3 }), rules);
    expect(out.rules_version).toBe('v1');
    expect(out.matched).toEqual({ metric: 'harsh_brake_count', op: '>=', value: 3 });
  });
});
