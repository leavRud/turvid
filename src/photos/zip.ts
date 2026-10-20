// ZIP-архив с фото и видео: распаковать в браузере в обычные файлы. Без DOM и сети.
// Архив читается в память целиком, поэтому у размера есть предел.

import JSZip from 'jszip';
import { classifyFile } from './files';

/** accept для кнопки выбора архива. */
export const ZIP_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

/** Больше — браузер (особенно на телефоне) может не вытянуть архив в память. */
export const MAX_ZIP_BYTES = 1024 ** 3;

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

export interface Expanded {
  files: File[];
  /** Что сказать человеку: пропущенные файлы, битые и слишком большие архивы. */
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
    if (file.size > MAX_ZIP_BYTES) {
      warnings.push(
        `${file.name}: архив больше 1 ГБ — распакуй его и выбери фото и видео обычной кнопкой`,
      );
      continue;
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch {
      warnings.push(`${file.name}: не получилось открыть архив — он повреждён или это не ZIP`);
      continue;
    }
    let found = 0;
    let skipped = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || isJunk(entry.name)) continue;
      const name = entry.name.split('/').pop() ?? entry.name;
      const ext = name.toLowerCase().split('.').pop() ?? '';
      if (classifyFile({ name, type: '', size: 0 }).kind === null) {
        skipped++;
        continue;
      }
      const data = await entry.async('blob');
      out.push(
        new File([data], name, { type: MIME[ext] ?? '', lastModified: entry.date.getTime() }),
      );
      found++;
    }
    if (!found) warnings.push(`${file.name}: в архиве нет фото и видео`);
    else if (skipped) {
      warnings.push(`${file.name}: пропущено ${skipped} — не фото и не видео`);
    }
  }
  return { files: out, warnings };
}
