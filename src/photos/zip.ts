// ZIP-архив с фото и видео: распаковать в обычные файлы по одному, не читая архив в память.
// Оглавление (central directory) — в конце архива; по нему каждый файл вырезается кусочком
// (Blob.slice). Несжатый файл (так обычно лежат JPEG и MP4) — просто ссылка на кусок архива,
// сжатый — распаковывает сам браузер (DecompressionStream). Поддержан ZIP64 (архивы > 4 ГБ).
// Без DOM и сети.

import { classifyFile } from './files';

/** accept для кнопки выбора архива. */
export const ZIP_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** Конец архива: 22 байта записи + комментарий до 64 КБ. */
const EOCD_SEARCH = 22 + 0xffff;
const STORED = 0;
const DEFLATED = 8;

export function isZip(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  return (
    file.name.toLowerCase().endsWith('.zip') ||
    type === 'application/zip' ||
    type === 'application/x-zip-compressed'
  );
}

/** Служебное от macOS и скрытые файлы — не снимки. */
function isJunk(path: string): boolean {
  return path.split('/').some((part) => part === '__MACOSX' || part.startsWith('.'));
}

class ZipError extends Error {}

export interface ZipEntry {
  /** Путь внутри архива. */
  path: string;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  size: number;
  /** Где в архиве начинается локальный заголовок файла. */
  headerOffset: number;
}

const u64 = (v: DataView, at: number): number => Number(v.getBigUint64(at, true));

async function bytes(blob: Blob, from: number, to: number): Promise<DataView> {
  return new DataView(await blob.slice(from, to).arrayBuffer());
}

/** Имя файла: UTF-8, если архив так говорит или оно правильное; иначе — DOS-кодировка (CP866). */
function decodeName(raw: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder().decode(raw);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('ibm866').decode(raw);
  }
}

/** Оглавление архива. */
export async function listZip(zip: Blob): Promise<ZipEntry[]> {
  const tailFrom = Math.max(0, zip.size - EOCD_SEARCH);
  const tail = await bytes(zip, tailFrom, zip.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('нет оглавления');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // ZIP64: настоящие числа — в отдельной записи, на неё указывает локатор прямо перед EOCD.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== SIG_ZIP64_LOCATOR) {
      throw new ZipError('нет записи ZIP64');
    }
    const recAt = u64(tail, loc + 8);
    const rec = await bytes(zip, recAt, recAt + 56);
    if (rec.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError('битая запись ZIP64');
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  if (cdOffset + cdSize > zip.size) throw new ZipError('оглавление за концом файла');

  const cd = await bytes(zip, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > cd.byteLength || cd.getUint32(at, true) !== SIG_CENTRAL) {
      throw new ZipError('битое оглавление');
    }
    const flags = cd.getUint16(at + 8, true);
    const method = cd.getUint16(at + 10, true);
    let compressedSize = cd.getUint32(at + 20, true);
    let size = cd.getUint32(at + 24, true);
    const nameLen = cd.getUint16(at + 28, true);
    const extraLen = cd.getUint16(at + 30, true);
    const commentLen = cd.getUint16(at + 32, true);
    let headerOffset = cd.getUint32(at + 42, true);
    const nameStart = cd.byteOffset + at + 46;
    const raw = new Uint8Array(cd.buffer, nameStart, nameLen);
    let path = decodeName(raw, (flags & 0x800) !== 0);

    // Доп. поля: 0x0001 — размеры и смещение ZIP64, 0x7075 — имя в UTF-8 (Info-ZIP).
    let e = at + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      let p = e + 4;
      if (id === 0x0001) {
        // Здесь только те поля, что в основной записи равны 0xFFFFFFFF, в этом порядке.
        if (size === 0xffffffff) {
          size = u64(cd, p);
          p += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, p);
          p += 8;
        }
        if (headerOffset === 0xffffffff) headerOffset = u64(cd, p);
      } else if (id === 0x7075 && len > 5) {
        path = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 5, len - 5));
      }
      e += 4 + len;
    }
    entries.push({
      path,
      method,
      encrypted: (flags & 1) !== 0,
      compressedSize,
      size,
      headerOffset,
    });
    at = extraEnd + commentLen;
  }
  return entries;
}

/** Содержимое файла из архива: кусок архива или распакованный поток. */
async function entryData(zip: Blob, entry: ZipEntry): Promise<Blob> {
  const local = await bytes(zip, entry.headerOffset, entry.headerOffset + 30);
  if (local.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('битый заголовок файла');
  const start = entry.headerOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const piece = zip.slice(start, start + entry.compressedSize);
  if (entry.method === STORED) return piece;
  const stream = piece.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).blob();
}

export interface Expanded {
  files: File[];
  /** Что сказать человеку: пропущенные файлы, битые архивы. */
  warnings: string[];
}

/**
 * Архивы среди файлов заменяет их фото и видео (в порядке внутри архива), остальное — как есть.
 * Имя файла — без папок: по нему читается время съёмки, если в самом файле его нет.
 */
export async function expandZips(files: File[]): Promise<Expanded> {
  const out: File[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    if (!isZip(file)) {
      out.push(file);
      continue;
    }
    let entries: ZipEntry[];
    try {
      entries = await listZip(file);
    } catch {
      warnings.push(`${file.name}: не получилось открыть архив — он повреждён или это не ZIP`);
      continue;
    }
    let found = 0;
    let skipped = 0;
    const warnedBefore = warnings.length;
    for (const entry of entries) {
      if (entry.path.endsWith('/') || isJunk(entry.path)) continue;
      const name = entry.path.split('/').pop() ?? entry.path;
      const ext = name.toLowerCase().split('.').pop() ?? '';
      const kind = classifyFile({ name, type: '', size: entry.size });
      if (kind.kind === null) {
        skipped++;
        continue;
      }
      // Слишком большие и зашифрованные — сразу, не распаковывая.
      if (kind.error) {
        warnings.push(kind.error);
        continue;
      }
      if (entry.encrypted || (entry.method !== STORED && entry.method !== DEFLATED)) {
        warnings.push(`${name}: в архиве зашифрован или сжат неизвестным способом`);
        continue;
      }
      try {
        const data = await entryData(file, entry);
        out.push(
          new File([data], name, { type: MIME[ext] ?? '', lastModified: file.lastModified }),
        );
        found++;
      } catch {
        warnings.push(`${name}: не получилось достать из архива — он повреждён`);
      }
    }
    if (!found && warnings.length === warnedBefore) {
      warnings.push(`${file.name}: в архиве нет фото и видео`);
    } else if (skipped) warnings.push(`${file.name}: пропущено ${skipped} — не фото и не видео`);
  }
  return { files: out, warnings };
}
