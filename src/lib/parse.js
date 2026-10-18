'use strict';

// Parses one lesson file: "# key: value" header lines followed by a CSV table.
// Speed is normalized to km/h here (files come in kmh or mph) so the rest of the
// code can assume km/h.

const SPEED_UNIT_TO_KMH = {
  kmh: 1,
  mph: 1.609344,
};

const REQUIRED_HEADERS = [
  'lesson_id',
  'student_id',
  'car_id',
  'lesson_type',
  'started_at',
  'sample_rate_hz',
  'speed_unit',
  'uploaded_at',
];

const NUMERIC_COLUMNS = [
  't_ms',
  'speed',
  'accel_long_ms2',
  'accel_lat_ms2',
  'steering_deg',
  'speed_limit_kmh',
];

/**
 * @param {string} content - the full text of the file.
 * @returns {{headers: object, columns: string[], rows: object[]}} rows include `speed_kmh`.
 * @throws if the file is malformed or missing required data.
 */
function parseLesson(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Empty lesson file');
  }

  const headers = {};
  let columns = null;
  const dataLines = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    if (line.startsWith('#')) {
      const body = line.slice(1).trim();
      const colonAt = body.indexOf(':');
      if (colonAt === -1) continue;
      headers[body.slice(0, colonAt).trim()] = body.slice(colonAt + 1).trim();
    } else if (columns === null) {
      columns = line.split(',').map((name) => name.trim());
    } else {
      dataLines.push(line);
    }
  }

  for (const key of REQUIRED_HEADERS) {
    if (!headers[key]) throw new Error(`Missing required header: ${key}`);
  }

  const sampleRateHz = Number(headers.sample_rate_hz);
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error(`Invalid sample_rate_hz: ${headers.sample_rate_hz}`);
  }

  const speedFactor = SPEED_UNIT_TO_KMH[headers.speed_unit];
  if (speedFactor === undefined) throw new Error(`Unknown speed_unit: ${headers.speed_unit}`);

  if (columns === null) throw new Error('No CSV header row found');
  if (dataLines.length === 0) throw new Error('No data rows found');

  const rows = dataLines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== columns.length) {
      throw new Error(`Row ${index + 1} has ${cells.length} columns, expected ${columns.length}`);
    }

    const row = {};
    columns.forEach((name, i) => {
      row[name] = cells[i].trim();
    });

    for (const name of NUMERIC_COLUMNS) {
      if (row[name] !== undefined) {
        const num = Number(row[name]);
        if (!Number.isFinite(num)) {
          throw new Error(`Row ${index + 1}: non-numeric ${name} = "${row[name]}"`);
        }
        row[name] = num;
      }
    }

    row.speed_kmh = row.speed * speedFactor;
    return row;
  });

  return { headers, columns, rows };
}

module.exports = { parseLesson, SPEED_UNIT_TO_KMH };
