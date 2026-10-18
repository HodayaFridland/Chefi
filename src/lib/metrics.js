'use strict';

// Per-lesson metrics (section 5). Input is parseLesson() output; every row has `speed_kmh`.

const MIN_EVENT_SAMPLES = 15; // a run must be this long to count as an event (0.3s @ 50Hz)
const MERGE_GAP_SAMPLES = 50; // runs closer than this merge into one event (1s @ 50Hz)

/**
 * Count "events": runs of >=15 consecutive matching rows, where two qualifying
 * runs less than 50 samples apart count as one.
 */
function countEvents(rows, predicate) {
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      runs.push([runStart, i - 1]);
      runStart = -1;
    }
  }
  if (runStart !== -1) runs.push([runStart, rows.length - 1]);

  const events = runs.filter(([start, end]) => end - start + 1 >= MIN_EVENT_SAMPLES);

  let count = 0;
  let prevEnd = null;
  for (const [start, end] of events) {
    const gap = prevEnd === null ? Infinity : start - prevEnd - 1;
    if (gap >= MERGE_GAP_SAMPLES) count++; // else merges with the previous event
    prevEnd = end;
  }
  return count;
}

function computeMetrics(parsed) {
  const { headers, rows } = parsed;
  const sampleCount = rows.length;
  const hz = Number(headers.sample_rate_hz);

  const duration_min = sampleCount / hz / 60;

  let distance_km = 0;
  let movingSpeedSum = 0;
  let movingSamples = 0;
  let samplesOverLimit = 0;
  let maxLateralAbs = 0;

  for (const row of rows) {
    distance_km += row.speed_kmh / 3.6 / hz / 1000; // km/h -> m/s -> metres this sample -> km
    if (row.speed_kmh > 2) {
      movingSpeedSum += row.speed_kmh;
      movingSamples += 1;
    }
    if (row.speed_kmh > row.speed_limit_kmh + 5) samplesOverLimit += 1; // 5 km/h tolerance
    const lateralAbs = Math.abs(row.accel_lat_ms2);
    if (lateralAbs > maxLateralAbs) maxLateralAbs = lateralAbs;
  }

  const avg_moving_speed_kmh = movingSamples > 0 ? movingSpeedSum / movingSamples : 0;
  const pct_time_over_limit = sampleCount > 0 ? (100 * samplesOverLimit) / sampleCount : 0;
  const max_lateral_g = maxLateralAbs / 9.81;

  const harsh_brake_count = countEvents(rows, (r) => r.accel_long_ms2 <= -3.5);
  const harsh_accel_count = countEvents(rows, (r) => r.accel_long_ms2 >= 3.0);
  const sharp_turn_count = countEvents(rows, (r) => Math.abs(r.accel_lat_ms2) >= 4.0);

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

module.exports = { computeMetrics, countEvents, MIN_EVENT_SAMPLES, MERGE_GAP_SAMPLES };
