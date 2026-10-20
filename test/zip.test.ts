import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MAX_VIDEO_BYTES } from '../src/photos/files';
import { expandZips, isZip, listZip } from '../src/photos/zip';

async function zipFile(
  name: string,
  entries: Record<string, string>,
  compression: 'STORE' | 'DEFLATE' = 'DEFLATE',
): Promise<File> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(entries)) zip.file(path, text);
  const data = await zip.generateAsync({ type: 'uint8array', compression });
  return new File([new Uint8Array(data)], name, { type: 'application/zip' });
}

/** Склеить байты. */
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Байты с записью чисел little-endian: [размер, значение]. */
function le(fields: [1 | 2 | 4 | 8, number][]): Uint8Array {
  const out = new Uint8Array(fields.reduce((n, [s]) => n + s, 0));
  const v = new DataView(out.buffer);
  let at = 0;
  for (const [size, value] of fields) {
    if (size === 1) v.setUint8(at, value);
    if (size === 2) v.setUint16(at, value, true);
    if (size === 4) v.setUint32(at, value, true);
    if (size === 8) v.setBigUint64(at, BigInt(value), true);
    at += size;
  }
  return out;
}

/**
 * Архив ZIP64 из одного несжатого файла, собранный руками: все размеры и смещения —
 * 0xFFFFFFFF, настоящие — в доп. поле и в записи ZIP64 (так пишут архивы больше 4 ГБ).
 */
function zip64(name: string, content: string, rawName?: Uint8Array): File {
  const data = new TextEncoder().encode(content);
  const nameBytes = rawName ?? new TextEncoder().encode(name);
  const utf8 = rawName ? 0 : 0x800;
  const local = concat([
    le([
      [4, 0x04034b50],
      [2, 45],
      [2, utf8],
      [2, 0],
      [2, 0],
      [2, 0],
      [4, 0],
    ]),
    le([
      [4, 0xffffffff],
      [4, 0xffffffff],
      [2, nameBytes.length],
      [2, 20],
    ]),
    nameBytes,
    le([
      [2, 1],
      [2, 16],
      [8, data.length],
      [8, data.length],
    ]),
    data,
  ]);
  const central = concat([
    le([
      [4, 0x02014b50],
      [2, 45],
      [2, 45],
      [2, utf8],
      [2, 0],
      [2, 0],
      [2, 0],
      [4, 0],
    ]),
    le([
      [4, 0xffffffff],
      [4, 0xffffffff],
      [2, nameBytes.length],
      [2, 28],
      [2, 0],
    ]),
    le([
      [2, 0],
      [2, 0],
      [4, 0],
      [4, 0xffffffff],
    ]),
    nameBytes,
    le([
      [2, 1],
      [2, 24],
      [8, data.length],
      [8, data.length],
      [8, 0],
    ]),
  ]);
  const cdOffset = local.length;
  const rec64At = cdOffset + central.length;
  const rec64 = le([
    [4, 0x06064b50],
    [8, 44],
    [2, 45],
    [2, 45],
    [4, 0],
    [4, 0],
    [8, 1],
    [8, 1],
    [8, central.length],
    [8, cdOffset],
  ]);
  const locator = le([
    [4, 0x07064b50],
    [4, 0],
    [8, rec64At],
    [4, 1],
  ]);
  const eocd = le([
    [4, 0x06054b50],
    [2, 0xffff],
    [2, 0xffff],
    [2, 0xffff],
    [2, 0xffff],
    [4, 0xffffffff],
    [4, 0xffffffff],
    [2, 0],
  ]);
  return new File([concat([local, central, rec64, locator, eocd])], 'big.zip');
}

describe('ZIP с фото и видео', () => {
  it('узнаёт архив по расширению и по типу', () => {
    expect(isZip({ name: 'Поход.ZIP', type: '' })).toBe(true);
    expect(isZip({ name: 'export', type: 'application/x-zip-compressed' })).toBe(true);
    expect(isZip({ name: 'IMG_1.jpg', type: 'image/jpeg' })).toBe(false);
  });

  it('достаёт фото и видео без папок, с типом по расширению — сжатые и нет', async () => {
    for (const compression of ['STORE', 'DEFLATE'] as const) {
      const zip = await zipFile(
        'day1.zip',
        {
          'DCIM/IMG_20261017_101500.jpg': 'jpg-данные',
          'DCIM/clip.MOV': 'mov'.repeat(1000),
          'b.heic': 'heic',
        },
        compression,
      );
      const { files, warnings } = await expandZips([zip]);
      expect(files.map((f) => [f.name, f.type])).toEqual([
        ['IMG_20261017_101500.jpg', 'image/jpeg'],
        ['clip.MOV', 'video/quicktime'],
        ['b.heic', 'image/heic'],
      ]);
      expect(await files[0]?.text()).toBe('jpg-данные');
      expect(await files[1]?.text()).toBe('mov'.repeat(1000));
      expect(warnings).toEqual([]);
    }
  });

  it('служебное macOS и скрытые файлы молча пропускает, прочее — с предупреждением', async () => {
    const zip = await zipFile('a.zip', {
      'a.jpg': 'x',
      '__MACOSX/._a.jpg': 'x',
      '.DS_Store': 'x',
      'notes.txt': 'x',
      'track.gpx': 'x',
    });
    const { files, warnings } = await expandZips([zip]);
    expect(files.map((f) => f.name)).toEqual(['a.jpg']);
    expect(warnings).toEqual(['a.zip: пропущено 2 — не фото и не видео']);
  });

  it('обычные файлы проходят как есть, рядом с распакованными', async () => {
    const photo = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    const zip = await zipFile('z.zip', { 'v.mp4': 'x' });
    const { files } = await expandZips([photo, zip]);
    expect(files[0]).toBe(photo);
    expect(files.map((f) => f.name)).toEqual(['p.jpg', 'v.mp4']);
  });

  it('пустой и битый архив — предупреждение, без падения', async () => {
    const empty = await zipFile('empty.zip', { 'readme.txt': 'x' });
    const broken = new File(['не архив'], 'broken.zip');
    const { files, warnings } = await expandZips([empty, broken]);
    expect(files).toEqual([]);
    expect(warnings).toEqual([
      'empty.zip: в архиве нет фото и видео',
      'broken.zip: не получилось открыть архив — он повреждён или это не ZIP',
    ]);
  });

  it('ZIP64 (архивы больше 4 ГБ): размеры и смещение — из доп. поля', async () => {
    const zip = zip64('VID_20261017_143205.mp4', 'видео');
    expect(await listZip(zip)).toEqual([
      expect.objectContaining({ path: 'VID_20261017_143205.mp4', size: 10, headerOffset: 0 }),
    ]);
    const { files } = await expandZips([zip]);
    expect(files.map((f) => f.name)).toEqual(['VID_20261017_143205.mp4']);
    expect(await files[0]?.text()).toBe('видео');
  });

  it('русское имя без флага UTF-8 (старый Windows) — читается как CP866', async () => {
    // «фото.jpg» в CP866: ф=0xE4 о=0xAE т=0xE2 о=0xAE.
    const raw = new Uint8Array([0xe4, 0xae, 0xe2, 0xae, ...new TextEncoder().encode('.jpg')]);
    const [entry] = await listZip(zip64('', 'x', raw));
    expect(entry?.path).toBe('фото.jpg');
  });

  it('слишком большое видео отсеивается по оглавлению, не распаковываясь', async () => {
    const zip = await zipFile('v.zip', { 'big.mp4': 'x' }, 'STORE');
    // Подменить размер в оглавлении: архив маленький, а видео «больше 50 МБ».
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, MAX_VIDEO_BYTES + 1, true);
    }
    const { files, warnings } = await expandZips([new File([bytes], 'v.zip')]);
    expect(files).toEqual([]);
    expect(warnings).toEqual([
      'big.mp4: видео больше 50 МБ — бесплатный Supabase такие не принимает',
    ]);
  });
});
