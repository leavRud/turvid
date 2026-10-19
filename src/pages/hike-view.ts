// Экран просмотра похода (раздел 5 ТЗ). Всё состояние — позиция на треке в метрах.
// Точки и фото меняются на лету (этап 4): после каждого изменения обновляются карта, полоса и панель.

import { getHike } from '../api/hikes';
import { deleteMedia, moveMedia, reorderMedia, storageUsage, uploadMedia } from '../api/media';
import { createPoint, deletePoint, updatePoint } from '../api/points';
import { createHikeMap, type HikeMap } from '../map/hike-map';
import { ATTACH_M, layoutMedia, type Placement } from '../photos/placement';
import { MediaError, prepareFile, type Prepared } from '../photos/prepare';
import { isNetworkError, runQueue } from '../photos/queue';
import { isNight, timeAxis } from '../player/axis';
import { keyTarget, nextPointPos, prevPointPos } from '../player/keys';
import { isMagnetic } from '../player/magnet';
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
import type { HikeBundle, MediaItem, Point } from '../types';
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
import { createSheet, SHEET_PEEK_PX } from '../ui/sheet';
import { themeSwitcher } from '../ui/theme';
import { isViewerOpen, openViewer } from '../ui/viewer';
import { createHikeMenu } from './hike-menu';
import { createPanel, type PlaceInfo, type UploadReport } from './hike-panel';
import { isReviewOpen, openReview } from './photo-review';

/** Как часто переписывать ?pos= в адресе, мс. */
const URL_DEBOUNCE_MS = 300;
/** Сколько файлов грузить одновременно. */
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_ATTEMPTS = 3;

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

export function mountHikeView(
  root: HTMLElement,
  bundle: HikeBundle,
  { editable = true }: { editable?: boolean } = {},
): () => void {
  const { hike } = bundle;
  const { track } = hike;
  const tz = hike.timezone;
  const length = trackLength(track);
  const startedAt = hike.started_at ? Date.parse(hike.started_at) / 1000 : null;
  const finishedAt = hike.finished_at ? Date.parse(hike.finished_at) / 1000 : null;
  const eleReliable = track.ele !== null && hike.elev_gain_m !== null;
  const dayRanges = splitDays(track.t, track.lat.length);
  const days = summarizeDays(track);
  const stops = track.t ? findStops(track.lat, track.lon, track.t, dayRanges) : [];
  /** Ось времени (та же, что у шкалы): где ночь между днями. null — трек без времени. */
  const tAxis = track.t ? timeAxis(track, days) : null;
  const cleanups: (() => void)[] = [];

  // Данные, которые меняются на экране
  let points: Point[] = [...bundle.points];
  let media: MediaItem[] = [...bundle.media];
  const sortPoints = (): void => {
    points = [...points].sort((a, b) => a.pos_m - b.pos_m);
  };
  const mediaOf = (pointId: string): MediaItem[] =>
    media.filter((m) => m.point_id === pointId).sort((a, b) => a.sort - b.sort);
  const unsortedMedia = (): MediaItem[] =>
    media.filter((m) => m.point_id === null).sort((a, b) => a.sort - b.sort);
  const pointPos = (): number[] => points.map((p) => p.pos_m);
  const magneticPos = (): number[] => {
    const counts = new Map<string, number>();
    for (const m of media)
      if (m.point_id) counts.set(m.point_id, (counts.get(m.point_id) ?? 0) + 1);
    return points.filter((p) => isMagnetic(p, counts)).map((p) => p.pos_m);
  };

  const store = createPositionStore(length, parsePosParam(location.search, length) ?? 0);

  /** Что известно о месте: километр, день, время суток, высота. */
  function describe(pos: number): PlaceInfo {
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
      multiDay: days.length > 1,
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
  const summary = h('p', { class: 'hike-summary' });
  const renderSummary = (): void => {
    summary.textContent = [
      formatKm(hike.distance_m),
      startedAt !== null && finishedAt !== null ? formatDuration(finishedAt - startedAt) : null,
      hike.moving_s !== null ? `в движении ${formatDuration(hike.moving_s)}` : null,
      eleReliable && hike.elev_gain_m !== null ? `набор ${formatMeters(hike.elev_gain_m)}` : null,
      `${days.length} ${plural(days.length, ['день', 'дня', 'дней'])}`,
      `${points.length} ${plural(points.length, ['точка', 'точки', 'точек'])}`,
      `${media.length} фото`,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  renderSummary();
  const titleEl = h('h1', {}, hike.title);
  document.title = `${hike.title} — Turvid`;
  // По публичной ссылке: без «Мои походы» и без меню (раздел 7 ТЗ).
  const header = h(
    'header',
    { class: 'hike-head' },
    h(
      'div',
      { class: 'hike-head-bar' },
      editable
        ? h('a', { href: '/', class: 'btn btn-ghost btn-small', 'data-link': true }, '← Походы')
        : h('span', { class: 'muted small-text' }, 'Turvid · дневник похода'),
      h(
        'div',
        { class: 'header-actions' },
        themeSwitcher(),
        editable
          ? createHikeMenu(hike, {
              onRename(title) {
                titleEl.textContent = title;
                document.title = `${title} — Turvid`;
              },
            })
          : null,
      ),
    ),
    titleEl,
    h('p', { class: 'muted' }, dates),
    summary,
  );
  cleanups.push(() => (document.title = 'Turvid'));

  // Карта
  const mapBox = h('div', { class: 'hike-map' });

  // Полоса и кнопки
  const strip = createStrip({
    track,
    days,
    stops,
    points: pointPos(),
    magnetic: magneticPos(),
    modes: stripModes(track, eleReliable, hike.elev_range_m),
    store,
    startedAt,
    timezone: tz,
  });
  cleanups.push(strip.destroy);

  const prevBtn = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', 'aria-label': 'К предыдущей точке' },
    '◀',
    h('span', { class: 'btn-label' }, ' Точка'),
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
    h('span', { class: 'btn-label' }, 'Точка '),
    '▶',
  );
  prevBtn.addEventListener('click', () =>
    store.set(prevPointPos(store.get(), pointPos()) ?? 0, 'buttons'),
  );
  nextBtn.addEventListener('click', () =>
    store.set(nextPointPos(store.get(), pointPos()) ?? length, 'buttons'),
  );
  const controls = h('div', { class: 'player-controls' }, prevBtn, playBtn, speedBtn, nextBtn);

  // Подпись в просмотре: название точки и время съёмки.
  const captionFor = (point: Point | null, m: MediaItem): string => {
    const name = point ? point.title || 'Точка без названия' : 'Неразобранное';
    if (!m.taken_at) return name;
    const sec = Date.parse(m.taken_at) / 1000;
    const approx = m.taken_approx ? ' (время примерное)' : '';
    return `${name} · ${formatShortDate(sec, tz)}, ${formatTime(sec, tz)}${approx}`;
  };

  // Панель точки
  const panel = createPanel({
    store,
    editable,
    points: () => points,
    mediaOf,
    unsorted: () => unsortedMedia(),
    autoUpload: (files) => void autoUpload(files),
    placeHere: (m) => placeMedia(m, store.get()),
    async removeMedia(m) {
      await deleteMedia(m);
      media = media.filter((x) => x.id !== m.id);
      dataChanged();
      panel.refreshStorage();
    },
    openUnsorted(index) {
      openViewer(
        unsortedMedia().map((m) => ({ media: m, caption: captionFor(null, m) })),
        index,
      );
    },
    describe,
    async createPointHere() {
      const pos = store.get();
      const p = pointAt(track, pos);
      return addPoint({ pos, lat: p.lat, lon: p.lon });
    },
    async savePoint(point, fields, order, removed) {
      const saved = await updatePoint(point.id, fields);
      for (const m of removed) await deleteMedia(m);
      await reorderMedia(order.map((m) => m.id));
      const removedIds = new Set(removed.map((m) => m.id));
      const sortOf = new Map(order.map((m, i) => [m.id, i]));
      media = media
        .filter((m) => !removedIds.has(m.id))
        .map((m) => (sortOf.has(m.id) ? { ...m, sort: sortOf.get(m.id) as number } : m));
      points = points.map((p) => (p.id === saved.id ? saved : p));
      dataChanged();
      if (removed.length) panel.refreshStorage();
    },
    async deletePoint(point) {
      await deletePoint(point.id);
      points = points.filter((p) => p.id !== point.id);
      media = media.map((m) => (m.point_id === point.id ? { ...m, point_id: null } : m));
      dataChanged(true);
    },
    upload: uploadFiles,
    openMedia(point, index) {
      const items = mediaOf(point.id).map((m) => ({ media: m, caption: captionFor(point, m) }));
      openViewer(items, index);
    },
    storage: () => storageUsage(hike.id),
  });

  /** Новая точка в месте трека: в базу, в список, стрелку — на неё, панель — в правку. */
  /**
   * Положить фото на трек в позицию pos: в точку ближе 100 м, если такая есть,
   * иначе — в новую точку здесь. Стрелка встаёт на эту точку.
   */
  async function placeMedia(m: MediaItem, pos: number): Promise<void> {
    let target = points
      .filter((p) => Math.abs(p.pos_m - pos) <= ATTACH_M)
      .sort((a, b) => Math.abs(a.pos_m - pos) - Math.abs(b.pos_m - pos))[0];
    if (!target) {
      const p = pointAt(track, pos);
      target = await addPoint({ pos, lat: p.lat, lon: p.lon });
    }
    const sort = mediaOf(target.id).reduce((max, x) => Math.max(max, x.sort + 1), 0);
    await moveMedia(m.id, target.id, sort);
    const pointId = target.id;
    media = media.map((x) => (x.id === m.id ? { ...x, point_id: pointId, sort } : x));
    dataChanged(true);
    store.set(target.pos_m, 'list');
  }

  /**
   * Загрузка в поход целиком (этап 5): подготовить файлы (время, место, сжатие),
   * разложить по маршруту, показать экран проверки и только после «Сохранить» — грузить.
   */
  async function autoUpload(files: File[]): Promise<void> {
    const busy = h('div', { class: 'busy', role: 'status' }, 'Готовлю фото…');
    document.body.append(busy);
    const prepared = new Map<string, Prepared>();
    const names = new Map<string, string>();
    const errors: string[] = [];
    try {
      const results = await runQueue(
        files,
        async (file, i) => {
          const key = `f${i}`;
          prepared.set(key, await prepareFile(file, tz));
          names.set(key, file.name);
        },
        {
          // Сжатие грузит процессор — по два файла сразу хватает.
          concurrency: 2,
          attempts: 1,
          backoffMs: () => 0,
          retryable: () => false,
          onSettled: (_i, done, total) => {
            busy.textContent = `Готовлю фото: ${done} из ${total}`;
          },
        },
      );
      results.forEach((r, i) => {
        if (!r.ok) {
          errors.push(
            r.error instanceof MediaError
              ? r.error.message
              : `${files[i]?.name ?? 'файл'}: ${errorText(r.error)}`,
          );
        }
      });
    } finally {
      busy.remove();
    }
    if (!prepared.size) {
      if (errors.length) window.alert(errors.join('\n'));
      return;
    }

    const keys = [...prepared.keys()];
    const { placements, layout } = layoutMedia(
      keys.map((key) => {
        const m = (prepared.get(key) as Prepared).media;
        return { id: key, takenAt: m.takenAt, lat: m.lat, lon: m.lon };
      }),
      track,
      startedAt,
      points.map((p) => ({ id: p.id, pos: p.pos_m })),
    );
    const placementOf = new Map(placements.map((p) => [p.id, p]));
    const thumbUrls = new Map(
      keys.map((key) => [key, URL.createObjectURL((prepared.get(key) as Prepared).media.thumb)]),
    );
    const warnings = keys.flatMap((key) => {
      const w = prepared.get(key)?.warning;
      return w ? [`${names.get(key) ?? ''}: ${w}`] : [];
    });

    openReview({
      track,
      bbox: hike.bbox,
      entries: keys.map((key) => {
        const m = (prepared.get(key) as Prepared).media;
        return {
          key,
          name: names.get(key) ?? key,
          thumbUrl: thumbUrls.get(key) ?? '',
          kind: m.kind,
          placement: placementOf.get(key) as Placement,
          approx: m.takenApprox,
          noData: m.takenApprox || (m.takenAt === null && m.lat === null),
        };
      }),
      layout,
      pointTitles: new Map(points.map((p) => [p.id, p.title])),
      km: formatKm,
      errors: [...errors, ...warnings],
      onClose: () => thumbUrls.forEach((url) => URL.revokeObjectURL(url)),
      async onSave(result, progress) {
        // Новые точки — сначала, чтобы фото было куда класть.
        const target = new Map<string, string | null>();
        for (const g of result.groups) {
          let pointId = g.pointId;
          if (!pointId) {
            const p = pointAt(track, g.pos);
            const created = await createPoint(
              hike.id,
              { pos_m: g.pos, lat: p.lat, lon: p.lon },
              g.title,
            );
            points = [...points, created];
            pointId = created.id;
          }
          for (const key of g.keys) target.set(key, pointId);
        }
        for (const key of result.unsorted) target.set(key, null);
        sortPoints();
        dataChanged();

        // Порядок внутри точки — по времени съёмки, после уже лежащих там фото.
        const nextSort = new Map<string | null, number>();
        const uploads = [...target.entries()]
          .map(([key, pointId]) => ({ key, pointId, m: (prepared.get(key) as Prepared).media }))
          .sort((a, b) => (a.m.takenAt ?? Infinity) - (b.m.takenAt ?? Infinity))
          .map((u) => {
            const base =
              nextSort.get(u.pointId) ??
              (u.pointId ? mediaOf(u.pointId) : unsortedMedia()).reduce(
                (max, x) => Math.max(max, x.sort + 1),
                0,
              );
            nextSort.set(u.pointId, base + 1);
            return { ...u, sort: base };
          });

        progress(`Загружаю: 0 из ${uploads.length}`);
        const results = await runQueue(
          uploads,
          async (u) => {
            const item = await uploadMedia(hike.id, u.pointId, u.sort, u.m);
            media = [...media, item];
            return item;
          },
          {
            concurrency: UPLOAD_CONCURRENCY,
            attempts: UPLOAD_ATTEMPTS,
            backoffMs: (attempt) => 1000 * 2 ** (attempt - 1),
            retryable: isNetworkError,
            onSettled: (_i, done, total) => {
              progress(`Загружаю: ${done} из ${total}`);
              dataChanged();
            },
          },
        );
        dataChanged(true);
        panel.refreshStorage();
        const failed = results.flatMap((r, i) =>
          r.ok ? [] : [`${names.get(uploads[i]?.key ?? '') ?? 'файл'}: ${errorText(r.error)}`],
        );
        if (failed.length) {
          window.alert(
            `Не загрузились ${failed.length} из ${uploads.length}:\n${failed.join('\n')}`,
          );
        }
      },
    });
  }

  async function addPoint(place: { pos: number; lat: number; lon: number }): Promise<Point> {
    const point = await createPoint(hike.id, { pos_m: place.pos, lat: place.lat, lon: place.lon });
    points = [...points, point];
    sortPoints();
    dataChanged();
    store.set(point.pos_m, 'list');
    return point;
  }

  /** Загрузка выбранных файлов в точку: по 3 сразу, с повтором при обрыве связи. */
  async function uploadFiles(
    point: Point,
    files: File[],
    progress: (done: number, total: number) => void,
  ): Promise<UploadReport> {
    const started = performance.now();
    const base = mediaOf(point.id).reduce((max, m) => Math.max(max, m.sort + 1), 0);
    // Подготовка (сжатие) — один раз; при повторе грузим уже готовое.
    const prepared = new Map<number, Prepared>();
    const warnings: string[] = [];
    const results = await runQueue(
      files,
      async (file, i) => {
        let ready = prepared.get(i);
        if (!ready) {
          ready = await prepareFile(file, tz);
          prepared.set(i, ready);
          if (ready.warning) warnings.push(`${file.name}: ${ready.warning}`);
        }
        const item = await uploadMedia(hike.id, point.id, base + i, ready.media);
        media = [...media, item];
        return item;
      },
      {
        concurrency: UPLOAD_CONCURRENCY,
        attempts: UPLOAD_ATTEMPTS,
        backoffMs: (attempt) => 1000 * 2 ** (attempt - 1),
        retryable: (err) => !(err instanceof MediaError) && isNetworkError(err),
        onSettled: (_i, done, total) => {
          progress(done, total);
          dataChanged();
        },
      },
    );
    const errors = results.flatMap((r, i) =>
      r.ok
        ? []
        : [
            r.error instanceof MediaError
              ? r.error.message
              : `${files[i]?.name ?? 'файл'}: ${errorText(r.error)}`,
          ],
    );
    panel.refreshStorage();
    return {
      uploaded: results.filter((r) => r.ok).length,
      errors,
      warnings,
      seconds: (performance.now() - started) / 1000,
    };
  }

  let map: HikeMap | null = null;

  /** Точки или фото поменялись — обновить всё, что их показывает. */
  function dataChanged(forcePanel = false): void {
    renderSummary();
    map?.setPoints(points);
    strip.setPoints(pointPos(), magneticPos());
    prevBtn.hidden = nextBtn.hidden = points.length === 0;
    if (forcePanel) panel.refresh();
    else panel.update();
    // Вызывается только после монтирования экрана — шторка к этому времени уже есть.
    sheet.setTitle(sheetTitle());
  }

  // На телефоне панель точки — шторка снизу, над полосой с ползунком (раздел 7 ТЗ).
  // Шторка открылась — «Следовать» держит стрелку над ней, а не под ней.
  const sheet = createSheet(panel.element, (_state, height) =>
    map?.setBottomInset(height > 0 ? height - SHEET_PEEK_PX : 0),
  );
  cleanups.push(sheet.destroy);
  const bottom = h('div', { class: 'hike-bottom' }, strip.element, controls);
  const viewEl = h(
    'main',
    { class: 'hike-view' },
    header,
    h(
      'div',
      { class: 'hike-body' },
      h('div', { class: 'hike-main' }, mapBox, bottom),
      sheet.element,
    ),
  );
  root.replaceChildren(viewEl);
  // Шторка стоит над нижней полосой — её высота меняется (режимы, перенос кнопок).
  const bottomObserver = new ResizeObserver(() => {
    viewEl.style.setProperty('--bottom-bar-h', `${bottom.offsetHeight}px`);
  });
  bottomObserver.observe(bottom);
  cleanups.push(() => bottomObserver.disconnect());

  /** Краешек шторки: точка, если стоим на ней, иначе — километр, день и время. */
  const sheetTitle = (): string => {
    const pos = store.get();
    const point = points.find((p) => Math.abs(p.pos_m - pos) < 0.5);
    if (!point) return badgeText(pos);
    const n = mediaOf(point.id).length;
    return `${point.title || 'Точка'}${n ? ` · ${n} фото` : ''} · ${formatKm(point.pos_m)}`;
  };
  sheet.setTitle(sheetTitle());

  // На компьютере фото можно просто бросить на экран похода — запустится автораскладка.
  if (editable) {
    const view = root.firstElementChild as HTMLElement;
    const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
    view.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      view.classList.add('dragging-files');
    });
    view.addEventListener('dragleave', (e) => {
      if (e.target === view) view.classList.remove('dragging-files');
    });
    view.addEventListener('drop', (e) => {
      view.classList.remove('dragging-files');
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void autoUpload(files);
    });
  }

  // Без WebGL MapLibre падает при создании — тогда остальной экран работает, а в рамке причина.
  try {
    map = createHikeMap({
      container: mapBox,
      track,
      bbox: hike.bbox,
      points,
      store,
      label: badgeText,
      magnetic: magneticPos,
      editable,
      async onPointMove(point, place) {
        try {
          const wasHere = Math.abs(store.get() - point.pos_m) < 0.5;
          const saved = await updatePoint(point.id, {
            pos_m: place.pos,
            lat: place.lat,
            lon: place.lon,
          });
          points = points.map((p) => (p.id === saved.id ? saved : p));
          sortPoints();
          dataChanged();
          if (wasHere) store.set(saved.pos_m, 'list');
        } catch (err) {
          map?.setPoints(points);
          window.alert(`Не получилось передвинуть точку: ${errorText(err)}`);
        }
      },
      onLongPress(place) {
        void addPoint(place)
          .then((point) => panel.edit(point.id))
          .catch((err: unknown) =>
            window.alert(`Не получилось поставить точку: ${errorText(err)}`),
          );
      },
      onDropMedia(mediaId, place) {
        const m = media.find((x) => x.id === mediaId);
        if (!m) return;
        void placeMedia(m, place.pos).catch((err: unknown) =>
          window.alert(`Не получилось положить фото: ${errorText(err)}`),
        );
      },
    });
    cleanups.push(() => map?.destroy());
  } catch (err) {
    mapBox.replaceChildren(
      h('p', { class: 'map-error' }, `Карта не загрузилась: ${errorText(err)}`),
    );
  }
  prevBtn.hidden = nextBtn.hidden = points.length === 0;

  // Позиция → панель и адрес страницы
  let urlTimer = 0;
  cleanups.push(() => clearTimeout(urlTimer));
  cleanups.push(
    store.subscribe((_pos, source) => {
      panel.update();
      sheet.setTitle(sheetTitle());
      // Нажали точку на карте или в списке — шторка выезжает до половины, видно карточку.
      if (source === 'list' && sheet.state() === 'peek') sheet.open('half');
      if (source !== 'play') stopPlay();
      clearTimeout(urlTimer);
      urlTimer = window.setTimeout(() => {
        const url = `${location.pathname}?pos=${Math.round(store.get())}`;
        history.replaceState(history.state, '', url);
      }, URL_DEBOUNCE_MS);
    }),
  );

  // Клавиатура
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || isViewerOpen() || isReviewOpen()) return;
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    const next = keyTarget(e.key, e.shiftKey, store.get(), length, pointPos());
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
  const rate = timeRate(hike.distance_m, hike.moving_s);
  speedBtn.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    speedBtn.textContent = `×${SPEEDS[speedIndex] ?? 1}`;
  });
  function frame(ts: number): void {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    const speed = SPEEDS[speedIndex] ?? 1;
    let done: boolean;
    if (tAxis) {
      const s = playStepTime({ t: playT, pause, done: false }, dt, speed, {
        rate,
        endT,
        pointTimes: pointPos().map((p) => timeAt(track, p) ?? 0),
        isNight: (t) => isNight(tAxis, t),
      });
      pause = s.pause;
      playT = s.t;
      done = s.done;
      store.set(posAtTime(track, playT), 'play', playT);
    } else {
      const s = playStep({ pos: store.get(), pause, done: false }, dt, speed, pointPos(), length);
      pause = s.pause;
      done = s.done;
      store.set(s.pos, 'play');
    }
    if (done) stopPlay();
    else raf = requestAnimationFrame(frame);
  }
  function startPlay(): void {
    if (tAxis) {
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
