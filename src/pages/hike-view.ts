// Экран просмотра похода (раздел 5 ТЗ). Всё состояние — позиция на треке в метрах.

import { getHike } from '../api/hikes';
import { createHikeMap } from '../map/hike-map';
import { keyTarget, nextPointPos, prevPointPos } from '../player/keys';
import { isNight, timeAxis } from '../player/axis';
import { playStep, playStepTime, SPEEDS, timeRate } from '../player/playback';
import {
  dayIndexAt,
  parsePosParam,
  pointAt,
  posAtTime,
  timeAt,
  trackLength,
} from '../player/position';
import { createPositionStore } from '../player/store';
import { createStrip } from '../player/strip';
import { stripModes } from '../player/strip-model';
import { splitDays, summarizeDays } from '../track/days';
import { findStops } from '../track/stops';
import type { HikeBundle } from '../types';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';
import {
  formatDateRange,
  formatDuration,
  formatKm,
  formatMeters,
  formatShortDate,
  formatTime,
  plural,
} from '../ui/format';

/** Как часто переписывать ?pos= в адресе, мс. */
const URL_DEBOUNCE_MS = 300;

/**
 * Загружает поход и показывает его. Возвращает функцию уборки.
 * isCurrent — экран ещё нужен: если пока грузили, ушли (или открыли поход второй раз),
 * опоздавший ответ ничего не рисует, иначе он затирал бы живой экран мёртвой копией.
 */
export async function renderHikeView(
  root: HTMLElement,
  id: string,
  isCurrent: () => boolean = () => true,
): Promise<() => void> {
  root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'muted' }, 'Загружаю поход…')));
  let bundle: HikeBundle | null;
  try {
    bundle = await getHike(id);
  } catch (err) {
    if (!isCurrent()) return () => undefined;
    root.replaceChildren(
      h(
        'main',
        { class: 'page' },
        h('p', { class: 'status status-error' }, `Не удалось загрузить поход: ${errorText(err)}`),
      ),
    );
    return () => undefined;
  }
  if (!isCurrent()) return () => undefined;
  if (!bundle) {
    root.replaceChildren(
      h(
        'main',
        { class: 'page page-narrow' },
        h('h1', {}, 'Поход не найден'),
        h('a', { href: '/', class: 'btn btn-ghost', 'data-link': true }, 'К походам'),
      ),
    );
    return () => undefined;
  }
  return mountHikeView(root, bundle);
}

export function mountHikeView(root: HTMLElement, { hike, points, photos }: HikeBundle): () => void {
  const { track } = hike;
  const tz = hike.timezone;
  const length = trackLength(track);
  const startedAt = hike.started_at ? Date.parse(hike.started_at) / 1000 : null;
  const finishedAt = hike.finished_at ? Date.parse(hike.finished_at) / 1000 : null;
  const eleReliable = track.ele !== null && hike.elev_gain_m !== null;
  const dayRanges = splitDays(track.t, track.lat.length);
  const days = summarizeDays(track);
  const stops = track.t ? findStops(track.lat, track.lon, track.t, dayRanges) : [];
  const pointPos = points.map((p) => p.pos_m);
  /** Ось времени (та же, что у шкалы): где ночь между днями. null — трек без времени. */
  const tAxis = track.t ? timeAxis(track, days) : null;
  const cleanups: (() => void)[] = [];

  const store = createPositionStore(length, parsePosParam(location.search, length) ?? 0);

  /** Что известно о месте: километр, день, время суток, высота. */
  function describe(pos: number): {
    km: string;
    day: string;
    time: string | null;
    date: string | null;
    ele: string | null;
  } {
    const p = pointAt(track, pos);
    // На стоянке и во сне время задано явно (проигрывание, шкала времени), иначе — первое прибытие.
    const t = store.time() ?? p.t;
    const night = tAxis !== null && t !== null && isNight(tAxis, t);
    const dayNo =
      t !== null
        ? Math.max(days.filter((d) => d.startT !== null && d.startT <= t).length, 1)
        : dayIndexAt(dayRanges, p.index) + 1;
    return {
      km: formatKm(pos),
      day: night ? `ночь после дня ${dayNo}` : `день ${dayNo}`,
      time: startedAt !== null && t !== null ? formatTime(startedAt + t, tz) : null,
      date: startedAt !== null && t !== null ? formatShortDate(startedAt + t, tz) : null,
      ele: eleReliable && p.ele !== null ? formatMeters(p.ele) : null,
    };
  }
  const badgeText = (pos: number): string => {
    const d = describe(pos);
    return [d.km, days.length > 1 ? d.day : null, d.time, d.ele].filter(Boolean).join(' · ');
  };

  // Шапка
  const dates =
    startedAt !== null && finishedAt !== null
      ? formatDateRange(startedAt, finishedAt, tz)
      : 'Без времени';
  const summary = [
    formatKm(hike.distance_m),
    startedAt !== null && finishedAt !== null ? formatDuration(finishedAt - startedAt) : null,
    hike.moving_s !== null ? `в движении ${formatDuration(hike.moving_s)}` : null,
    eleReliable && hike.elev_gain_m !== null ? `набор ${formatMeters(hike.elev_gain_m)}` : null,
    `${days.length} ${plural(days.length, ['день', 'дня', 'дней'])}`,
    `${points.length} ${plural(points.length, ['точка', 'точки', 'точек'])}`,
    `${photos} фото`,
  ]
    .filter(Boolean)
    .join(' · ');

  const header = h(
    'header',
    { class: 'hike-head' },
    h('a', { href: '/', class: 'btn btn-ghost btn-small', 'data-link': true }, '← Мои походы'),
    h('h1', {}, hike.title),
    h('p', { class: 'muted' }, dates),
    h('p', { class: 'hike-summary' }, summary),
  );

  // Карта
  const mapBox = h('div', { class: 'hike-map' });

  // Полоса и кнопки
  const strip = createStrip({
    track,
    days,
    stops,
    points: pointPos,
    modes: stripModes(track, eleReliable, hike.elev_range_m),
    store,
    startedAt,
    timezone: tz,
  });
  cleanups.push(strip.destroy);

  const prevBtn = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', 'aria-label': 'К предыдущей точке' },
    '◀ Точка',
  );
  const playBtn = h('button', { type: 'button', class: 'btn btn-primary play-btn' }, '▶ Играть');
  const speedBtn = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Скорость проигрывания' },
    '×1',
  );
  const nextBtn = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', 'aria-label': 'К следующей точке' },
    'Точка ▶',
  );
  prevBtn.addEventListener('click', () =>
    store.set(prevPointPos(store.get(), pointPos) ?? 0, 'buttons'),
  );
  nextBtn.addEventListener('click', () =>
    store.set(nextPointPos(store.get(), pointPos) ?? length, 'buttons'),
  );
  if (!points.length) {
    prevBtn.hidden = true;
    nextBtn.hidden = true;
  }
  const controls = h('div', { class: 'player-controls' }, prevBtn, playBtn, speedBtn, nextBtn);

  // Панель: где я сейчас и список точек
  const nowKm = h('dd', {});
  const nowDay = h('dd', {});
  const nowTime = h('dd', {});
  const nowEle = h('dd', {});
  const nowList = h(
    'dl',
    { class: 'now' },
    h('div', {}, h('dt', {}, 'Километр'), nowKm),
    days.length > 1 ? h('div', {}, h('dt', {}, 'День'), nowDay) : null,
    startedAt !== null ? h('div', {}, h('dt', {}, 'Время'), nowTime) : null,
    eleReliable ? h('div', {}, h('dt', {}, 'Высота'), nowEle) : null,
  );
  const pointButtons = points.map((p) => {
    const b = h(
      'button',
      { type: 'button', class: 'point-item' },
      h('span', { class: 'point-title' }, p.title || 'Без названия'),
      h('span', { class: 'muted' }, formatKm(p.pos_m)),
    );
    b.addEventListener('click', () => store.set(p.pos_m, 'list'));
    return b;
  });
  const panel = h(
    'aside',
    { class: 'hike-panel' },
    h('h2', { class: 'section-title' }, 'Сейчас'),
    nowList,
    h('h2', { class: 'section-title' }, 'Точки'),
    pointButtons.length
      ? h('div', { class: 'point-list' }, ...pointButtons)
      : h('p', { class: 'muted' }, 'Точек пока нет. Создавать их можно будет на следующем этапе.'),
  );

  function updatePanel(pos: number): void {
    const d = describe(pos);
    const day = d.day.charAt(0).toUpperCase() + d.day.slice(1);
    nowKm.textContent = d.km;
    nowDay.textContent = d.date ? `${day}, ${d.date}` : day;
    nowTime.textContent = d.time ?? '—';
    nowEle.textContent = d.ele ?? '—';
  }

  root.replaceChildren(
    h(
      'main',
      { class: 'hike-view' },
      header,
      h(
        'div',
        { class: 'hike-body' },
        h('div', { class: 'hike-main' }, mapBox, strip.element, controls),
        panel,
      ),
    ),
  );

  // Без WebGL MapLibre падает при создании — тогда остальной экран работает, а в рамке причина.
  try {
    const map = createHikeMap({
      container: mapBox,
      track,
      bbox: hike.bbox,
      points,
      store,
      label: badgeText,
    });
    cleanups.push(map.destroy);
  } catch (err) {
    mapBox.replaceChildren(
      h('p', { class: 'map-error' }, `Карта не загрузилась: ${errorText(err)}`),
    );
  }

  // Позиция → панель и адрес страницы
  let urlTimer = 0;
  cleanups.push(() => clearTimeout(urlTimer));
  cleanups.push(
    store.subscribe((pos, source) => {
      updatePanel(pos);
      if (source !== 'play') stopPlay();
      clearTimeout(urlTimer);
      urlTimer = window.setTimeout(() => {
        const url = `${location.pathname}?pos=${Math.round(store.get())}`;
        history.replaceState(history.state, '', url);
      }, URL_DEBOUNCE_MS);
    }),
  );
  updatePanel(store.get());

  // Клавиатура
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    const next = keyTarget(e.key, e.shiftKey, store.get(), length, pointPos);
    if (next === null) return;
    e.preventDefault();
    store.set(next, 'keys');
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  // Проигрывание: со временем в треке — по времени (стоянки длятся, ночь ускорена),
  // без времени — по расстоянию.
  let speedIndex = SPEEDS.indexOf(1);
  let playing = false;
  let raf = 0;
  let pause = 0;
  let lastTs = 0;
  /** Часы проигрывания, секунды от старта: на стоянке позиция стоит, а они идут. */
  let playT = 0;
  const endT = track.t ? (track.t[track.t.length - 1] ?? 0) : 0;
  const timeCtx = tAxis
    ? {
        rate: timeRate(hike.distance_m, hike.moving_s),
        endT,
        pointTimes: pointPos.map((p) => timeAt(track, p) ?? 0),
        isNight: (t: number) => isNight(tAxis, t),
      }
    : null;
  speedBtn.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    speedBtn.textContent = `×${SPEEDS[speedIndex] ?? 1}`;
  });
  function frame(ts: number): void {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    const speed = SPEEDS[speedIndex] ?? 1;
    let done: boolean;
    if (timeCtx) {
      const s = playStepTime({ t: playT, pause, done: false }, dt, speed, timeCtx);
      pause = s.pause;
      playT = s.t;
      done = s.done;
      store.set(posAtTime(track, playT), 'play', playT);
    } else {
      const s = playStep({ pos: store.get(), pause, done: false }, dt, speed, pointPos, length);
      pause = s.pause;
      done = s.done;
      store.set(s.pos, 'play');
    }
    if (done) stopPlay();
    else raf = requestAnimationFrame(frame);
  }
  function startPlay(): void {
    if (timeCtx) {
      playT = store.time() ?? timeAt(track, store.get()) ?? 0;
      if (playT >= endT) playT = 0;
      store.set(posAtTime(track, playT), 'play', playT);
    } else if (store.get() >= length) {
      store.set(0, 'play');
    }
    playing = true;
    pause = 0;
    lastTs = 0;
    playBtn.textContent = '❚❚ Пауза';
    raf = requestAnimationFrame(frame);
  }
  function stopPlay(): void {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    playBtn.textContent = '▶ Играть';
  }
  playBtn.addEventListener('click', () => (playing ? stopPlay() : startPlay()));
  cleanups.push(stopPlay);

  return () => cleanups.forEach((c) => c());
}
