import { describe, expect, it } from 'vitest';
import { isPublic, matchRoute } from '../src/router';

describe('matchRoute', () => {
  it('корень — список походов', () => {
    expect(matchRoute('/')).toEqual({ name: 'hikes' });
    expect(matchRoute('')).toEqual({ name: 'hikes' });
  });

  it('вход, с хвостовым слэшем и без', () => {
    expect(matchRoute('/login')).toEqual({ name: 'login' });
    expect(matchRoute('/login/')).toEqual({ name: 'login' });
  });

  it('новый поход', () => {
    expect(matchRoute('/new')).toEqual({ name: 'newHike' });
  });

  it('неизвестный путь — notFound', () => {
    expect(matchRoute('/nope/')).toEqual({ name: 'notFound', path: '/nope' });
  });
});

describe('isPublic', () => {
  it('без входа доступен только экран входа', () => {
    expect(isPublic({ name: 'login' })).toBe(true);
    expect(isPublic({ name: 'hikes' })).toBe(false);
    expect(isPublic({ name: 'notFound', path: '/x' })).toBe(false);
  });
});
