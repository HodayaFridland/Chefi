'use strict';

/**
 * parse.js
 * ---------
 * Turns the raw text of one lesson file into a clean, validated object.
 *
 * A lesson file looks like this:
 *
 *   # lesson_id: L-1001
 *   # student_id: S-001
 *   ...more "# key: value" header lines...
 *   # speed_unit: kmh
 *   t_ms,speed,accel_long_ms2,accel_lat_ms2,steering_deg,speed_limit_kmh
 *   0,0.12,1.514,-0.111,-1.91,90
 *   20,0.23,1.565,0.103,1.41,90
 *   ...
 *
 * The only unit conversion lives here: `speed` is given in `speed_unit`
 * (kmh or mph), but every later calculation works in km/h. So we normalize
 * it once, at the edge, and expose `speed_kmh` on every row. Everything
 * downstream can then assume km/h and stay unit-agnostic.
 */

// How many km/h is one unit of the given speed_unit.
const SPEED_UNIT_TO_KMH = {
  kmh: 1,
  mph: 1.609344, // exact definition of a mile in km
};

// Headers we require to be present and non-empty. If one is missing the file
// is considered invalid and we throw, so the caller can reject it cleanly.
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

// Numeric columns we expect in the CSV table.
const NUMERIC_COLUMNS = [
  't_ms',
  'speed',
  'accel_long_ms2',
  'accel_lat_ms2',
  'steering_deg',
  'speed_limit_kmh',
];

/**
 * Parse one lesson file.
 * @param {string} content - the full text of the file.
 * @returns {{headers: object, columns: string[], rows: object[]}}
 *          headers: the "# key: value" lines as a string map.
 *          columns: the CSV column names, in order.
 *          rows: one object per data row, numbers parsed, plus `speed_kmh`.
 * @throws {Error} if the file is malformed or missing required data.
 */
function parseLesson(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Empty lesson file');
  }

  const headers = {};
  let columns = null; // set when we meet the first non-"#" line (the CSV header)
  const dataLines = [];

  // One pass over the lines. "#" lines are headers; the first plain line is
  // the column header; the rest are data rows. Blank lines are ignored.
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    if (line.startsWith('#')) {
      // "# key: value" -> headers[key] = value
      const body = line.slice(1).trim();
      const colonAt = body.indexOf(':');
      if (colonAt === -1) continue; // not a key:value comment, skip it
      const key = body.slice(0, colonAt).trim();
      const value = body.slice(colonAt + 1).trim();
      headers[key] = value;
    } else if (columns === null) {
      columns = line.split(',').map((name) => name.trim());
    } else {
      dataLines.push(line);
    }
  }

  // --- Validation: fail loudly and clearly on anything unexpected. ---
  for (const key of REQUIRED_HEADERS) {
    if (!headers[key]) {
      throw new Error(`Missing required header: ${key}`);
    }
  }

  const sampleRateHz = Number(headers.sample_rate_hz);
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error(`Invalid sample_rate_hz: ${headers.sample_rate_hz}`);
  }

  const speedFactor = SPEED_UNIT_TO_KMH[headers.speed_unit];
  if (speedFactor === undefined) {
    throw new Error(`Unknown speed_unit: ${headers.speed_unit}`);
  }

  if (columns === null) {
    throw new Error('No CSV header row found');
  }
  if (dataLines.length === 0) {
    throw new Error('No data rows found');
  }

  // --- Turn each CSV line into a typed row with speed normalized to km/h. ---
  const rows = dataLines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== columns.length) {
      throw new Error(
        `Row ${index + 1} has ${cells.length} columns, expected ${columns.length}`
      );
    }

    const row = {};
    columns.forEach((name, i) => {
      row[name] = cells[i].trim();
    });

    // Convert the expected numeric columns from string to number.
    for (const name of NUMERIC_COLUMNS) {
      if (row[name] !== undefined) {
        const num = Number(row[name]);
        if (!Number.isFinite(num)) {
          throw new Error(`Row ${index + 1}: non-numeric ${name} = "${row[name]}"`);
        }
        row[name] = num;
      }
    }

    // The single normalization: speed in the file's unit -> km/h.
    row.speed_kmh = row.speed * speedFactor;
    return row;
  });

  return { headers, columns, rows };
}

module.exports = { parseLesson, SPEED_UNIT_TO_KMH };
