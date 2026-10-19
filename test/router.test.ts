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

  it('поход по id', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(matchRoute('/hikes/' + id)).toEqual({ name: 'hike', id });
    expect(matchRoute('/hikes/123')).toEqual({ name: 'notFound', path: '/hikes/123' });
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

describe('публичная ссылка и статистика', () => {
  it('/s/<token> — публичный маршрут', () => {
    const token = 'RkTj12cCVLkLuPH3MsR1kp';
    expect(matchRoute('/s/' + token)).toEqual({ name: 'shared', token });
    expect(isPublic({ name: 'shared', token })).toBe(true);
    expect(matchRoute('/s/short')).toEqual({ name: 'notFound', path: '/s/short' });
  });

  it('/stats — только после входа', () => {
    expect(matchRoute('/stats')).toEqual({ name: 'stats' });
    expect(isPublic({ name: 'stats' })).toBe(false);
  });
});
