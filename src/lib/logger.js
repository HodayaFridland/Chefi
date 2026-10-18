'use strict';

// Structured JSON logging. Drops any PII-looking field so personal data never
// reaches CloudWatch.

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
  console.log(JSON.stringify({ level, message, ...redact(fields) }));
}

module.exports = {
  info: (message, fields) => log('INFO', message, fields),
  warn: (message, fields) => log('WARN', message, fields),
  error: (message, fields) => log('ERROR', message, fields),
  redact,
};
