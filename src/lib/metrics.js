'use strict';

/**
 * metrics.js
 * ----------
 * Computes the per-lesson metrics defined in section 5 of the assignment.
 *
 * Input is the object returned by parseLesson(): { headers, columns, rows },
 * where every row already has `speed_kmh` (km/h) thanks to the parser.
 *
 * The one tricky metric is "event" counting (harsh braking / acceleration /
 * sharp turns). An event is NOT just "a sample over the threshold" — see
 * countEvents() below for the exact rule.
 */

// Event-detection constants from section 5.
const MIN_EVENT_SAMPLES = 15; // 0.3s at 50 Hz: a run must be this long to count
const MERGE_GAP_SAMPLES = 50; // 1.0s at 50 Hz: runs closer than this are one event

/**
 * Count "events" in a sequence of rows.
 *
 * Rule (section 5):
 *  - A run = consecutive rows that all satisfy `predicate`.
 *  - A run becomes an event only if it is at least MIN_EVENT_SAMPLES long
 *    (15 consecutive samples). Shorter runs are ignored.
 *  - Two events separated by fewer than MERGE_GAP_SAMPLES samples (less than
 *    1 second of non-matching samples between them) count as a single event.
 *
 * @param {object[]} rows - the lesson rows, in time order.
 * @param {(row: object) => boolean} predicate - the event condition.
 * @returns {number} the number of distinct events.
 */
function countEvents(rows, predicate) {
  // Step 1: collect the maximal runs of consecutive matching rows as
  // [startIndex, endIndex] pairs (both inclusive).
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) {
      if (runStart === -1) runStart = i; // a run just began
    } else if (runStart !== -1) {
      runs.push([runStart, i - 1]); // a run just ended at i-1
      runStart = -1;
    }
  }
  if (runStart !== -1) runs.push([runStart, rows.length - 1]); // run reached the end

  // Step 2: keep only runs long enough to be an event.
  const events = runs.filter(([start, end]) => end - start + 1 >= MIN_EVENT_SAMPLES);

  // Step 3: walk the events in order; start a new count only when the gap to
  // the previous event is MERGE_GAP_SAMPLES or more. Closer events merge into
  // the one we are already counting.
  let count = 0;
  let prevEnd = null;
  for (const [start, end] of events) {
    const gap = prevEnd === null ? Infinity : start - prevEnd - 1;
    if (gap >= MERGE_GAP_SAMPLES) count++;
    prevEnd = end;
  }
  return count;
}

/**
 * Compute every section-5 metric for one parsed lesson.
 * @param {{headers: object, rows: object[]}} parsed - output of parseLesson().
 * @returns {object} the metrics, with lesson_score clamped to 0..100.
 */
function computeMetrics(parsed) {
  const { headers, rows } = parsed;
  const sampleCount = rows.length;
  const hz = Number(headers.sample_rate_hz);

  // duration_min = samples / rate / 60
  const duration_min = sampleCount / hz / 60;

  // Single pass for the sum/mean/share/max metrics.
  let distance_km = 0;
  let movingSpeedSum = 0;
  let movingSamples = 0;
  let samplesOverLimit = 0;
  let maxLateralAbs = 0;

  for (const row of rows) {
    // distance: convert km/h -> m/s (÷3.6), ÷rate gives metres for this sample,
    // ÷1000 gives km. Summed over all samples.
    distance_km += row.speed_kmh / 3.6 / hz / 1000;

    // average speed only over "moving" samples (speed_kmh > 2)
    if (row.speed_kmh > 2) {
      movingSpeedSum += row.speed_kmh;
      movingSamples += 1;
    }

    // over the posted limit with a 5 km/h tolerance
    if (row.speed_kmh > row.speed_limit_kmh + 5) {
      samplesOverLimit += 1;
    }

    const lateralAbs = Math.abs(row.accel_lat_ms2);
    if (lateralAbs > maxLateralAbs) maxLateralAbs = lateralAbs;
  }

  const avg_moving_speed_kmh = movingSamples > 0 ? movingSpeedSum / movingSamples : 0;
  const pct_time_over_limit = sampleCount > 0 ? (100 * samplesOverLimit) / sampleCount : 0;
  const max_lateral_g = maxLateralAbs / 9.81; // g = (m/s²) / 9.81

  // Event-based metrics.
  const harsh_brake_count = countEvents(rows, (r) => r.accel_long_ms2 <= -3.5);
  const harsh_accel_count = countEvents(rows, (r) => r.accel_long_ms2 >= 3.0);
  const sharp_turn_count = countEvents(rows, (r) => Math.abs(r.accel_lat_ms2) >= 4.0);

  // Composite score, then clamp to the 0..100 range.
  const rawScore =
    100 -
    2 * pct_time_over_limit -
    5 * harsh_brake_count -
    3 * harsh_accel_count -
    4 * sharp_turn_count;
  const lesson_score = Math.max(0, Math.min(100, rawScore));

  return {
    duration_min,
    distance_km,
    avg_moving_speed_kmh,
    pct_time_over_limit,
    harsh_brake_count,
    harsh_accel_count,
    sharp_turn_count,
    max_lateral_g,
    lesson_score,
  };
}

module.exports = {
  computeMetrics,
  countEvents,
  MIN_EVENT_SAMPLES,
  MERGE_GAP_SAMPLES,
};
