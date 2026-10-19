import { describe, expect, it } from 'vitest';
import { fitSize } from '../src/photos/compress';
import { exifTimeToUnix, wallTimeToUnix, zoneOffsetMinutes } from '../src/photos/exif-time';
import { classifyFile, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from '../src/photos/files';
import { isNetworkError, runQueue } from '../src/photos/queue';
import { isMagnetic, magnetTarget } from '../src/player/magnet';

const utc = (iso: string): number => Date.parse(iso) / 1000;

describe('время из EXIF', () => {
  it('пояс по IANA-зоне', () => {
    expect(zoneOffsetMinutes(Date.parse('2026-10-17T10:00:00Z'), 'Europe/Moscow')).toBe(180);
    expect(zoneOffsetMinutes(Date.parse('2026-07-01T10:00:00Z'), 'Europe/Berlin')).toBe(120);
    expect(zoneOffsetMinutes(Date.parse('2026-12-01T10:00:00Z'), 'Europe/Berlin')).toBe(60);
  });

  it('время «на часах» в поясе похода', () => {
    expect(wallTimeToUnix(2026, 10, 17, 14, 32, 5, 'Europe/Moscow')).toBe(
      utc('2026-10-17T11:32:05Z'),
    );
  });

  it('OffsetTimeOriginal важнее пояса похода', () => {
    expect(exifTimeToUnix('2026:10:17 14:32:05', '+05:00', 'Europe/Moscow')).toBe(
      utc('2026-10-17T09:32:05Z'),
    );
    expect(exifTimeToUnix('2026:10:17 14:32:05', '-0230', 'Europe/Moscow')).toBe(
      utc('2026-10-17T17:02:05Z'),
    );
  });

  it('без смещения — в поясе похода', () => {
    expect(exifTimeToUnix('2026:10:17 14:32:05', null, 'Europe/Moscow')).toBe(
      utc('2026-10-17T11:32:05Z'),
    );
  });

  it('мусор — null', () => {
    expect(exifTimeToUnix('0000:00:00 00:00:00', null, 'UTC')).toBeNull();
    expect(exifTimeToUnix('', null, 'UTC')).toBeNull();
    expect(exifTimeToUnix(undefined, null, 'UTC')).toBeNull();
  });
});

describe('размер при сжатии', () => {
  it('длинная сторона 2048, маленькие не растут', () => {
    expect(fitSize(4000, 3000, 2048)).toEqual([2048, 1536]);
    expect(fitSize(3000, 4000, 400)).toEqual([300, 400]);
    expect(fitSize(800, 600, 2048)).toEqual([800, 600]);
  });
});

describe('какие файлы берём', () => {
  const f = (name: string, type: string, size = 1000) => ({ name, type, size });

  it('фото, в том числе HEIC и пустой тип', () => {
    expect(classifyFile(f('a.jpg', 'image/jpeg'))).toMatchObject({ kind: 'photo', error: null });
    expect(classifyFile(f('IMG_1.HEIC', ''))).toMatchObject({ kind: 'photo', heic: true });
    expect(classifyFile(f('x.webp', ''))).toMatchObject({ kind: 'photo', error: null });
  });

  it('видео', () => {
    expect(classifyFile(f('v.MOV', 'video/quicktime'))).toMatchObject({
      kind: 'video',
      ext: 'mov',
    });
    expect(classifyFile(f('v.mp4', ''))).toMatchObject({ kind: 'video', ext: 'mp4' });
  });

  it('лимиты: фото 25 МБ, видео 50 МБ', () => {
    expect(classifyFile(f('a.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1)).error).toMatch(/25 МБ/);
    expect(classifyFile(f('v.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1)).error).toMatch(/50 МБ/);
  });

  it('прочее — не берём', () => {
    expect(classifyFile(f('doc.pdf', 'application/pdf')).error).toMatch(/не поддерживается/);
  });
});

describe('очередь загрузки', () => {
  const noSleep = (): Promise<void> => Promise.resolve();

  it('не больше трёх задач одновременно, результат в порядке входа', async () => {
    let active = 0;
    let peak = 0;
    const results = await runQueue(
      [1, 2, 3, 4, 5, 6, 7],
      async (x) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return x * 10;
      },
      { concurrency: 3, attempts: 1, backoffMs: () => 0, retryable: () => false },
    );
    expect(peak).toBe(3);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('повтор при обрыве связи, но не при «формат не тот»', async () => {
    const calls = new Map<string, number>();
    const settled: number[] = [];
    const results = await runQueue(
      ['flaky', 'bad'],
      async (name) => {
        const n = (calls.get(name) ?? 0) + 1;
        calls.set(name, n);
        if (name === 'flaky' && n < 3) throw new TypeError('Failed to fetch');
        if (name === 'bad') throw new Error('формат не поддерживается');
        return name;
      },
      {
        concurrency: 2,
        attempts: 3,
        backoffMs: () => 0,
        retryable: isNetworkError,
        sleep: noSleep,
        onSettled: (_i, done) => settled.push(done),
      },
    );
    expect(results[0]).toEqual({ ok: true, value: 'flaky' });
    expect(results[1]?.ok).toBe(false);
    expect(calls.get('flaky')).toBe(3);
    expect(calls.get('bad')).toBe(1);
    expect(settled).toEqual([1, 2]);
  });

  it('сетевые ошибки', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'Gateway timeout 504' })).toBe(true);
    expect(isNetworkError(new Error('new row violates row-level security'))).toBe(false);
  });
});

describe('магнит', () => {
  it('ближайшая цель в пределах 12 px', () => {
    expect(magnetTarget(100, [80, 108, 115])).toBe(1);
    expect(magnetTarget(100, [80, 120])).toBeNull();
    expect(magnetTarget(100, [88])).toBe(0);
  });

  it('магнитны точки с фото или заметкой', () => {
    const counts = new Map([['a', 2]]);
    expect(isMagnetic({ id: 'a', title: '', description: '' }, counts)).toBe(true);
    expect(isMagnetic({ id: 'b', title: 'Родник', description: '' }, counts)).toBe(true);
    expect(isMagnetic({ id: 'c', title: ' ', description: '' }, counts)).toBe(false);
  });
});
