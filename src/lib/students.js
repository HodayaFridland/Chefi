'use strict';

/**
 * students.js
 * -----------
 * Reads students.csv into an array of student records. Simple comma-split is
 * enough here: the file has no quoted fields or embedded commas.
 *
 * NOTE: these records contain personal data (name, national_id, phone, email).
 * Keep them out of logs. Only the state fields are needed for processing; the
 * contact fields are stored (encrypted) for the instructor read API later.
 */

function parseStudents(content) {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const record = {};
    header.forEach((name, i) => {
      record[name] = (cells[i] ?? '').trim();
    });
    return record;
  });
}

module.exports = { parseStudents };
