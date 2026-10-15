'use strict';

/**
 * logger.js
 * ---------
 * Minimal structured (JSON) logging for CloudWatch.
 *
 * The assignment requires that personal data is never written to logs. We only
 * ever log identifiers and metrics (lesson_id, student_id, counts, result) —
 * never names, emails, phones or national ids. As a safety net, this logger
 * drops any field whose name looks like personal data.
 */

const PII_KEYS = new Set([
  'full_name',
  'name',
  'national_id',
  'date_of_birth',
  'dob',
  'phone',
  'email',
]);

function redact(fields) {
  const safe = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (!PII_KEYS.has(key)) safe[key] = value;
  }
  return safe;
}

function log(level, message, fields = {}) {
  // One JSON object per line is the format CloudWatch Logs Insights parses best.
  console.log(JSON.stringify({ level, message, ...redact(fields) }));
}

module.exports = {
  info: (message, fields) => log('INFO', message, fields),
  warn: (message, fields) => log('WARN', message, fields),
  error: (message, fields) => log('ERROR', message, fields),
  redact,
};
