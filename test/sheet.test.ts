import { describe, expect, it } from 'vitest';
import { snapSheet, toggleSheet } from '../src/ui/sheet-snap';

const hs = { peek: 64, half: 400, full: 700 };

describe('шторка', () => {
  it('медленно отпустили — к ближайшему положению', () => {
    expect(snapSheet(100, 0, hs)).toBe('peek');
    expect(snapSheet(350, 0.1, hs)).toBe('half');
    expect(snapSheet(620, -0.1, hs)).toBe('full');
  });

  it('смахнули вверх — на следующее положение выше', () => {
    expect(snapSheet(90, 1, hs)).toBe('half');
    expect(snapSheet(420, 1, hs)).toBe('full');
    expect(snapSheet(700, 1, hs)).toBe('full');
  });

  it('смахнули вниз — на следующее ниже', () => {
    expect(snapSheet(650, -1, hs)).toBe('half');
    expect(snapSheet(380, -1, hs)).toBe('peek');
    expect(snapSheet(64, -1, hs)).toBe('peek');
  });

  it('щелчок по краю: свёрнута — до половины, иначе — свернуть', () => {
    expect(toggleSheet('peek')).toBe('half');
    expect(toggleSheet('half')).toBe('peek');
    expect(toggleSheet('full')).toBe('peek');
  });
});
