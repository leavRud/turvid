/// <reference types="node" />
// Медленный тест: полный эталонный файл Zepp (51 000 точек, 13,7 МБ) по критериям раздела 4 ТЗ.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTrackFile } from '../src/parse';
import { splitDays } from '../src/track/days';
import { processTrack, WARNINGS } from '../src/track/process';
import { findStops } from '../src/track/stops';

describe('эталон zepp-2days.gpx', () => {
  it('2 дня, 31–33 км, высота ненадёжна, ~23 остановки, быстро', async () => {
    const buf = readFileSync('test/fixtures/zepp-2days.gpx');
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

    const started = performance.now();
    const r = processTrack(await parseTrackFile('zepp-2days.gpx', data));
    const elapsed = performance.now() - started;

    expect(r.stats.days).toBe(2);
    expect(r.stats.distanceM).toBeGreaterThan(31_000);
    expect(r.stats.distanceM).toBeLessThan(33_000);
    expect(r.elevation).toBe('unreliable');
    expect(r.warnings).toContain(WARNINGS.badElevation);
    expect(r.stats.elevGainM).toBeNull();
    expect(r.stats.stops).toBeGreaterThanOrEqual(21);
    expect(r.stats.stops).toBeLessThanOrEqual(25);
    expect(r.timezone).toBe('Europe/Moscow');
    expect(r.track.lat.length).toBeLessThanOrEqual(5000);
    // В Node это доли секунды; запас на медленные машины CI.
    expect(elapsed).toBeLessThan(3000);
  });

  it('по упрощённому треку дни и крупные остановки находятся так же', async () => {
    const buf = readFileSync('test/fixtures/zepp-2days.gpx');
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const { track } = processTrack(await parseTrackFile('zepp-2days.gpx', data));
    const t = track.t ?? [];
    const days = splitDays(t, t.length);
    expect(days).toHaveLength(2);
    const long = findStops(track.lat, track.lon, t, days).filter((s) => s.durationS >= 45 * 60);
    expect(long.length).toBeGreaterThanOrEqual(3);
  });
});
