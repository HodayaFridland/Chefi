'use strict';

// Reads students.csv into records. These contain personal data; keep them out of logs.

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
