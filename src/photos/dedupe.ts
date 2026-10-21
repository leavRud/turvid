// Повторы среди выбранных файлов: одно и то же фото, сохранённое дважды (из мессенджера,
// с Google Диска). Сравниваем содержимое, а не имя. Без DOM и сети.

import { plural } from '../ui/format';

/** Отпечаток содержимого файла. */
export type HashFn = (file: Blob) => Promise<string>;

export async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Deduped<T> {
  /** Первые экземпляры, в исходном порядке. */
  unique: T[];
  /** Пропущенные повторы. */
  duplicates: T[];
}

/**
 * Убрать файлы с одинаковым содержимым, оставив первый. Хеш считаем только у файлов
 * с одинаковым размером — остальные заведомо разные, их не читаем.
 */
export async function dropDuplicates<T extends Blob>(
  files: T[],
  hash: HashFn = sha256,
): Promise<Deduped<T>> {
  const bySize = new Map<number, number>();
  for (const f of files) bySize.set(f.size, (bySize.get(f.size) ?? 0) + 1);
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const f of files) {
    if ((bySize.get(f.size) ?? 0) < 2) {
      unique.push(f);
      continue;
    }
    const key = `${f.size}:${await hash(f)}`;
    if (seen.has(key)) duplicates.push(f);
    else {
      seen.add(key);
      unique.push(f);
    }
  }
  return { unique, duplicates };
}

/** Строка для человека: «Пропущено 5 повторов: …». */
export function duplicatesNote(duplicates: { name: string }[]): string | null {
  const n = duplicates.length;
  if (!n) return null;
  const word = plural(n, ['повтор', 'повтора', 'повторов']);
  const names = duplicates.slice(0, 3).map((f) => f.name);
  const more = n > 3 ? ` и ещё ${n - 3}` : '';
  return `Пропущено ${n} ${word} — такие же файлы уже есть среди выбранных: ${names.join(', ')}${more}.`;
}
