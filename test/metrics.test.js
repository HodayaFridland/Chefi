'use strict';

const { computeMetrics, countEvents } = require('../src/lib/metrics');

// Build `n` rows where the given field has `value`; other fields default to 0.
function rows(n, field, value) {
  return Array.from({ length: n }, () => ({
    speed_kmh: 0,
    speed_limit_kmh: 0,
    accel_long_ms2: 0,
    accel_lat_ms2: 0,
    [field]: value,
  }));
}

// Concatenate several row groups into one sequence.
function concat(...groups) {
  return [].concat(...groups);
}

describe('countEvents', () => {
  const braking = (r) => r.accel_long_ms2 <= -3.5;

  test('a run shorter than 15 samples is not an event', () => {
    expect(countEvents(rows(14, 'accel_long_ms2', -4), braking)).toBe(0);
  });

  test('a run of exactly 15 samples is one event', () => {
    expect(countEvents(rows(15, 'accel_long_ms2', -4), braking)).toBe(1);
  });

  test('two long runs 49 samples apart merge into one event', () => {
    const seq = concat(
      rows(15, 'accel_long_ms2', -4), // event A
      rows(49, 'accel_long_ms2', 0), // 49-sample gap (< 50)
      rows(15, 'accel_long_ms2', -4) // event B, merged with A
    );
    expect(countEvents(seq, braking)).toBe(1);
  });

  test('two long runs 50 samples apart are two events', () => {
    const seq = concat(
      rows(15, 'accel_long_ms2', -4),
      rows(50, 'accel_long_ms2', 0), // 50-sample gap (>= 50)
      rows(15, 'accel_long_ms2', -4)
    );
    expect(countEvents(seq, braking)).toBe(2);
  });

  test('a short run between events is ignored and does not split them', () => {
    const seq = concat(
      rows(15, 'accel_long_ms2', -4), // event A
      rows(10, 'accel_long_ms2', 0), // gap
      rows(5, 'accel_long_ms2', -4), // too-short run, ignored
      rows(10, 'accel_long_ms2', 0), // gap; A and B are 25 apart total
      rows(15, 'accel_long_ms2', -4) // event B, merged with A (< 50)
    );
    expect(countEvents(seq, braking)).toBe(1);
  });

  test('no matching samples means no events', () => {
    expect(countEvents(rows(100, 'accel_long_ms2', 0), braking)).toBe(0);
  });
});

describe('computeMetrics', () => {
  // 150 samples at 50 Hz, steady 36 km/h (= 10 m/s), limit 90, no harsh events.
  const steady = {
    headers: { sample_rate_hz: '50' },
    rows: rows(150, 'speed_kmh', 36).map((r) => ({ ...r, speed_limit_kmh: 90 })),
  };

  test('duration_min = samples / rate / 60', () => {
    const m = computeMetrics(steady);
    expect(m.duration_min).toBeCloseTo(150 / 50 / 60, 10); // 0.05 min
  });

  test('distance_km integrates speed over time', () => {
    const m = computeMetrics(steady);
    // 10 m/s for 150 samples at 50 Hz = 10 * (150/50) = 30 m = 0.03 km
    expect(m.distance_km).toBeCloseTo(0.03, 10);
  });

  test('avg_moving_speed_kmh ignores samples with speed <= 2', () => {
    const mixed = {
      headers: { sample_rate_hz: '50' },
      rows: concat(
        rows(100, 'speed_kmh', 40), // moving
        rows(100, 'speed_kmh', 0) // stopped, excluded
      ).map((r) => ({ ...r, speed_limit_kmh: 90 })),
    };
    expect(computeMetrics(mixed).avg_moving_speed_kmh).toBeCloseTo(40, 10);
  });

  test('pct_time_over_limit uses a 5 km/h tolerance', () => {
    const data = {
      headers: { sample_rate_hz: '50' },
      rows: concat(
        rows(50, 'speed_kmh', 96), // 96 > 90 + 5 -> over
        rows(50, 'speed_kmh', 95) // 95 is not > 95 -> not over
      ).map((r) => ({ ...r, speed_limit_kmh: 90 })),
    };
    expect(computeMetrics(data).pct_time_over_limit).toBeCloseTo(50, 10);
  });

  test('max_lateral_g is peak |lateral accel| / 9.81', () => {
    const data = {
      headers: { sample_rate_hz: '50' },
      rows: concat(
        rows(10, 'accel_lat_ms2', 1.0),
        rows(1, 'accel_lat_ms2', -4.905) // peak |a| = 4.905 -> 0.5 g
      ),
    };
    expect(computeMetrics(data).max_lateral_g).toBeCloseTo(0.5, 6);
  });

  test('lesson_score penalises events and clamps at 0', () => {
    // 20 braking events would give 100 - 5*20 = 0 (clamped, not negative).
    const brakeRun = () =>
      concat(rows(15, 'accel_long_ms2', -4), rows(50, 'accel_long_ms2', 0));
    const manyBrakes = {
      headers: { sample_rate_hz: '50' },
      rows: concat(...Array.from({ length: 20 }, brakeRun)).map((r) => ({
        ...r,
        speed_kmh: 10,
        speed_limit_kmh: 90,
      })),
    };
    const m = computeMetrics(manyBrakes);
    expect(m.harsh_brake_count).toBe(20);
    expect(m.lesson_score).toBe(0);
  });

  test('a clean lesson scores 100', () => {
    expect(computeMetrics(steady).lesson_score).toBe(100);
  });
});
