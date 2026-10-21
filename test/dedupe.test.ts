import { describe, expect, it } from 'vitest';
import { dropDuplicates, duplicatesNote, sha256 } from '../src/photos/dedupe';

const file = (name: string, content: string): File => new File([content], name);

describe('повторы среди выбранных файлов', () => {
  it('одинаковое содержимое под разными именами — оставляем первый', async () => {
    const a = file('1792351452926.jpg', 'фото-А');
    const b = file('1792351453119.jpg', 'фото-Б');
    const a2 = file('1792351710423.jpg', 'фото-А');
    const { unique, duplicates } = await dropDuplicates([a, b, a2]);
    expect(unique).toEqual([a, b]);
    expect(duplicates).toEqual([a2]);
  });

  it('тот же размер, но другое содержимое — не повтор', async () => {
    const { unique, duplicates } = await dropDuplicates([
      file('x.jpg', 'abc'),
      file('y.jpg', 'abd'),
    ]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toEqual([]);
  });

  it('файлы с уникальным размером не читаются', async () => {
    const hashed: string[] = [];
    const hash = async (f: Blob): Promise<string> => {
      hashed.push((f as File).name);
      return sha256(f);
    };
    await dropDuplicates([file('a.jpg', '1'), file('b.jpg', '22'), file('c.jpg', '33')], hash);
    expect(hashed).toEqual(['b.jpg', 'c.jpg']);
  });

  it('sha256 — как у всех', async () => {
    expect(await sha256(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('сообщение: число, склонение, первые три имени', () => {
    expect(duplicatesNote([])).toBeNull();
    expect(duplicatesNote([{ name: 'a.jpg' }])).toBe(
      'Пропущено 1 повтор — такие же файлы уже есть среди выбранных: a.jpg.',
    );
    const five = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.jpg` }));
    expect(duplicatesNote(five)).toBe(
      'Пропущено 5 повторов — такие же файлы уже есть среди выбранных: a.jpg, b.jpg, c.jpg и ещё 2.',
    );
  });
});
