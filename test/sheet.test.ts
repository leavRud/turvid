import { describe, expect, it } from 'vitest';
import { snapSheet, toggleSheet } from '../src/ui/sheet-snap';

const hs = { peek: 64, full: 700 };

describe('шторка', () => {
  it('медленно отпустили — к ближайшему из двух положений, без половины', () => {
    expect(snapSheet(100, 0, hs)).toBe('peek');
    expect(snapSheet(350, 0.1, hs)).toBe('peek');
    expect(snapSheet(400, -0.1, hs)).toBe('full');
    expect(snapSheet(620, -0.1, hs)).toBe('full');
  });

  it('смахнули вверх — открыть целиком', () => {
    expect(snapSheet(90, 1, hs)).toBe('full');
    expect(snapSheet(700, 1, hs)).toBe('full');
  });

  it('смахнули вниз — свернуть', () => {
    expect(snapSheet(650, -1, hs)).toBe('peek');
    expect(snapSheet(64, -1, hs)).toBe('peek');
  });

  it('щелчок по краю: свёрнута — открыть, открыта — свернуть', () => {
    expect(toggleSheet('peek')).toBe('full');
    expect(toggleSheet('full')).toBe('peek');
  });
});
