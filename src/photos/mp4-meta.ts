// Метаданные MP4/MOV без библиотек: время создания из бокса mvhd и координаты ISO 6709.
// Чистые функции над байтами; чтение кусков файла — в readVideoMeta.

/** Секунд между 1904-01-01 (эпоха QuickTime) и 1970-01-01. */
const MAC_EPOCH_OFFSET = 2_082_844_800;

function findAscii(bytes: Uint8Array, text: string, from = 0): number {
  const codes = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - codes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * creation_time из бокса mvhd, секунды Unix (UTC). null — нет бокса или там ноль
 * (часть камер его не заполняет).
 */
export function mvhdCreationTime(bytes: Uint8Array): number | null {
  const at = findAscii(bytes, 'mvhd');
  if (at < 0 || at + 16 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[at + 4];
  let secs: number;
  if (version === 1) {
    if (at + 16 > bytes.length) return null;
    secs = Number(view.getBigUint64(at + 8));
  } else {
    secs = view.getUint32(at + 8);
  }
  if (!secs) return null;
  const unix = secs - MAC_EPOCH_OFFSET;
  // Мусор и «1904 год» отсекаем.
  return unix > 946_684_800 && unix < 4_102_444_800 ? unix : null;
}

/** Координаты из строки ISO 6709: «+61.1132+029.8750/» или «+61.1132+029.8750+012.000/». */
export function parseIso6709(text: string): { lat: number; lon: number } | null {
  const m = /([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/**
 * Координаты из метаданных: Android пишет «©xyz», iPhone — ключ
 * com.apple.quicktime.location.ISO6709. Ищем строку ISO 6709 сразу после маркера.
 */
export function videoLocation(bytes: Uint8Array): { lat: number; lon: number } | null {
  const decoder = new TextDecoder('latin1');
  for (const marker of ['©xyz', 'location.ISO6709']) {
    let from = 0;
    for (;;) {
      const at = findAscii(bytes, marker, from);
      if (at < 0) break;
      const tail = decoder.decode(bytes.subarray(at + marker.length, at + marker.length + 120));
      const loc = parseIso6709(tail);
      if (loc) return loc;
      from = at + 1;
    }
  }
  return null;
}

/** Сколько читать с начала и с конца файла: moov бывает и там, и там. */
const HEAD_BYTES = 2 * 1024 * 1024;
const TAIL_BYTES = 8 * 1024 * 1024;

export interface VideoMeta {
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
}

/** Время съёмки и координаты видео. Ошибки чтения не роняют загрузку — просто пусто. */
export async function readVideoMeta(file: Blob): Promise<VideoMeta> {
  const out: VideoMeta = { takenAt: null, lat: null, lon: null };
  try {
    const chunks = [file.slice(0, HEAD_BYTES)];
    if (file.size > HEAD_BYTES)
      chunks.push(file.slice(Math.max(HEAD_BYTES, file.size - TAIL_BYTES)));
    for (const chunk of chunks) {
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      out.takenAt ??= mvhdCreationTime(bytes);
      if (out.lat === null) {
        const loc = videoLocation(bytes);
        if (loc) {
          out.lat = loc.lat;
          out.lon = loc.lon;
        }
      }
    }
  } catch {
    // пусто — разложится по имени файла или уйдёт в неразобранные
  }
  return out;
}
