import { describe, expect, it } from 'vitest';
import { timeFromFilename } from '../src/photos/filename-time';
import { mvhdCreationTime, parseIso6709, videoLocation } from '../src/photos/mp4-meta';

const utc = (iso: string): number => Date.parse(iso) / 1000;
const MSK = 'Europe/Moscow';

describe('время из имени файла', () => {
  it('Telegram Desktop', () => {
    expect(timeFromFilename('photo_2026-10-17_14-32-05.jpg', MSK)).toBe(
      utc('2026-10-17T11:32:05Z'),
    );
    expect(timeFromFilename('photo_2026-10-17_14-32-05 (2).jpg', MSK)).toBe(
      utc('2026-10-17T11:32:05Z'),
    );
  });

  it('камеры Android и Samsung', () => {
    expect(timeFromFilename('IMG_20261017_143205.jpg', MSK)).toBe(utc('2026-10-17T11:32:05Z'));
    expect(timeFromFilename('VID_20261017_143205.mp4', MSK)).toBe(utc('2026-10-17T11:32:05Z'));
    expect(timeFromFilename('20261017_143205.jpg', MSK)).toBe(utc('2026-10-17T11:32:05Z'));
  });

  it('незнакомое имя и мусор — null', () => {
    expect(timeFromFilename('DSC00042.JPG', MSK)).toBeNull();
    expect(timeFromFilename('IMG_20261399_143205.jpg', MSK)).toBeNull();
    expect(timeFromFilename('photo.jpg', MSK)).toBeNull();
  });
});

/** Минимальный бокс mvhd: размер, тип, версия+флаги, creation_time. */
function mvhd(version: 0 | 1, unix: number): Uint8Array {
  const mac = unix + 2_082_844_800;
  const bytes = new Uint8Array(version === 1 ? 32 : 24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(
    [...'mvhd'].map((c) => c.charCodeAt(0)),
    4,
  );
  view.setUint8(8, version);
  if (version === 1) view.setBigUint64(12, BigInt(mac));
  else view.setUint32(12, mac);
  // Перед боксом — немного «чужих» байтов, как в настоящем файле.
  return new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101, ...bytes]);
}

describe('метаданные видео', () => {
  const t = utc('2026-10-17T11:32:05Z');

  it('creation_time из mvhd, версии 0 и 1', () => {
    expect(mvhdCreationTime(mvhd(0, t))).toBe(t);
    expect(mvhdCreationTime(mvhd(1, t))).toBe(t);
  });

  it('нет бокса или ноль — null', () => {
    expect(mvhdCreationTime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(mvhdCreationTime(mvhd(0, -2_082_844_800))).toBeNull();
  });

  it('координаты ISO 6709', () => {
    expect(parseIso6709('+61.1132+029.8750/')).toEqual({ lat: 61.1132, lon: 29.875 });
    expect(parseIso6709('-33.8688+151.2093+058.000/')).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parseIso6709('+00.0000+000.0000/')).toBeNull();
    expect(parseIso6709('nothing')).toBeNull();
  });

  it('координаты после маркера ©xyz (Android) и ключа Apple', () => {
    const enc = (s: string): number[] => [...s].map((c) => c.charCodeAt(0) & 0xff);
    const android = new Uint8Array([
      ...enc('junk©xyz'),
      0,
      18,
      21,
      199,
      ...enc('+61.1132+029.8750/'),
    ]);
    expect(videoLocation(android)).toEqual({ lat: 61.1132, lon: 29.875 });
    const apple = new Uint8Array([
      ...enc('com.apple.quicktime.location.ISO6709'),
      0,
      0,
      0,
      1,
      ...enc('+61.1132+029.8750+010.000/'),
    ]);
    expect(videoLocation(apple)).toEqual({ lat: 61.1132, lon: 29.875 });
    expect(videoLocation(new Uint8Array(enc('no location here')))).toBeNull();
  });
});
