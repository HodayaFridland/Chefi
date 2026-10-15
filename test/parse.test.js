'use strict';

const { parseLesson } = require('../src/lib/parse');

// A tiny, valid lesson file we can reason about by hand.
const KMH_FILE = [
  '# lesson_id: L-TEST',
  '# student_id: S-001',
  '# car_id: CAR-01',
  '# lesson_type: REGULAR',
  '# started_at: 2026-10-05T08:00:00Z',
  '# sample_rate_hz: 50',
  '# speed_unit: kmh',
  '# uploaded_at: 2026-10-05T08:27:00Z',
  't_ms,speed,accel_long_ms2,accel_lat_ms2,steering_deg,speed_limit_kmh',
  '0,10,1.0,0.1,-1.0,90',
  '20,20,-0.5,0.2,1.0,90',
].join('\n');

describe('parseLesson', () => {
  test('reads headers into a string map', () => {
    const { headers } = parseLesson(KMH_FILE);
    expect(headers.lesson_id).toBe('L-TEST');
    expect(headers.student_id).toBe('S-001');
    expect(headers.lesson_type).toBe('REGULAR');
    expect(headers.speed_unit).toBe('kmh');
  });

  test('parses data rows into numbers', () => {
    const { rows } = parseLesson(KMH_FILE);
    expect(rows).toHaveLength(2);
    expect(rows[0].t_ms).toBe(0);
    expect(rows[0].speed).toBe(10);
    expect(rows[1].accel_long_ms2).toBe(-0.5);
  });

  test('keeps km/h speed unchanged in speed_kmh', () => {
    const { rows } = parseLesson(KMH_FILE);
    expect(rows[0].speed_kmh).toBe(10);
  });

  test('converts mph to km/h in speed_kmh', () => {
    const mphFile = KMH_FILE.replace('speed_unit: kmh', 'speed_unit: mph');
    const { rows } = parseLesson(mphFile);
    // 10 mph = 16.09344 km/h, 20 mph = 32.18688 km/h
    expect(rows[0].speed_kmh).toBeCloseTo(16.09344, 5);
    expect(rows[1].speed_kmh).toBeCloseTo(32.18688, 5);
    // The raw `speed` column stays as recorded.
    expect(rows[0].speed).toBe(10);
  });

  test('tolerates blank lines and CRLF line endings', () => {
    const messy = KMH_FILE.replace(/\n/g, '\r\n') + '\r\n\r\n';
    const { rows } = parseLesson(messy);
    expect(rows).toHaveLength(2);
  });

  test('throws when a required header is missing', () => {
    const noStudent = KMH_FILE.replace('# student_id: S-001\n', '');
    expect(() => parseLesson(noStudent)).toThrow(/student_id/);
  });

  test('throws on an unknown speed unit', () => {
    const weird = KMH_FILE.replace('speed_unit: kmh', 'speed_unit: knots');
    expect(() => parseLesson(weird)).toThrow(/speed_unit/);
  });

  test('throws on a non-numeric cell', () => {
    const bad = KMH_FILE.replace('0,10,1.0,0.1,-1.0,90', '0,fast,1.0,0.1,-1.0,90');
    expect(() => parseLesson(bad)).toThrow(/non-numeric/);
  });

  test('throws on an empty file', () => {
    expect(() => parseLesson('')).toThrow(/Empty/);
  });
});
