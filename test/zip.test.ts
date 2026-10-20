import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { expandZips, isZip } from '../src/photos/zip';

async function zipFile(name: string, entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(entries)) zip.file(path, text);
  const data = await zip.generateAsync({ type: 'uint8array' });
  return new File([new Uint8Array(data)], name, { type: 'application/zip' });
}

describe('ZIP с фото и видео', () => {
  it('узнаёт архив по расширению и по типу', () => {
    expect(isZip({ name: 'Поход.ZIP', type: '' })).toBe(true);
    expect(isZip({ name: 'export', type: 'application/x-zip-compressed' })).toBe(true);
    expect(isZip({ name: 'IMG_1.jpg', type: 'image/jpeg' })).toBe(false);
  });

  it('достаёт фото и видео без папок, с типом по расширению', async () => {
    const zip = await zipFile('day1.zip', {
      'DCIM/IMG_20261017_101500.jpg': 'jpg',
      'DCIM/clip.MOV': 'mov',
      'b.heic': 'heic',
    });
    const { files, warnings } = await expandZips([zip]);
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ['IMG_20261017_101500.jpg', 'image/jpeg'],
      ['clip.MOV', 'video/quicktime'],
      ['b.heic', 'image/heic'],
    ]);
    expect(warnings).toEqual([]);
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
});
