// Экран проверки автораскладки (раздел 6 ТЗ): карта с предложенными точками и список
// «точка → её фото». Можно перенести фото в другую точку или в неразобранные,
// переименовать новые точки, отменить всё. Ничего не грузится, пока не нажали «Сохранить».

import { POINT_TITLE_MAX } from '../api/points';
import { createReviewMap, type ReviewMap } from '../map/review-map';
import type { Layout, Placement } from '../photos/placement';
import type { TrackData } from '../types';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';
import { plural } from '../ui/format';

export interface ReviewEntry {
  /** Ключ внутри экрана (не id в базе — в базе ещё ничего нет). */
  key: string;
  name: string;
  thumbUrl: string;
  kind: 'photo' | 'video';
  placement: Placement;
  /** Время из имени файла. */
  approx: boolean;
  /** Ни времени, ни координат в самом файле — похоже на фото из мессенджера. */
  noData: boolean;
}

export interface ReviewGroup {
  /** Существующая точка; null — новая. */
  pointId: string | null;
  pos: number;
  title: string;
  keys: string[];
}

export interface ReviewResult {
  groups: ReviewGroup[];
  unsorted: string[];
}

export interface ReviewOptions {
  track: TrackData;
  bbox: [number, number, number, number];
  entries: ReviewEntry[];
  layout: Layout;
  /** Названия существующих точек. */
  pointTitles: Map<string, string>;
  /** «12,4 км» для позиции. */
  km: (pos: number) => string;
  /** Файлы, которые не удалось подготовить. */
  errors: string[];
  onSave: (result: ReviewResult, progress: (text: string) => void) => Promise<void>;
  onClose: () => void;
}

const MESSENGER_HINT =
  'Похоже, фото сжаты мессенджером. Попроси прислать их файлом — тогда они сами встанут на маршрут.';

let openCount = 0;

/** Открыт ли экран проверки — тогда клавиши экрана похода не работают. */
export function isReviewOpen(): boolean {
  return openCount > 0;
}

export function openReview(opts: ReviewOptions): void {
  const entries = new Map(opts.entries.map((e) => [e.key, e]));
  let groups: ReviewGroup[] = opts.layout.groups.map((g) => ({
    pointId: g.pointId,
    pos: g.pos,
    title: g.pointId ? (opts.pointTitles.get(g.pointId) ?? '') : '',
    keys: [...g.ids],
  }));
  let unsorted = [...opts.layout.unsorted];

  const mapBox = h('div', { class: 'review-map' });
  const list = h('div', { class: 'review-groups' });
  const status = h('p', { class: 'status', role: 'status' });
  const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Сохранить');
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Отменить всё');
  const summary = h('p', { class: 'muted' });

  const anyNoData = opts.entries.some((e) => e.noData);
  const root = h(
    'div',
    { class: 'review', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Раскладка фото' },
    h(
      'div',
      { class: 'review-inner' },
      h(
        'header',
        { class: 'review-head' },
        h('h2', {}, 'Раскладка фото'),
        summary,
        anyNoData ? h('p', { class: 'warning' }, MESSENGER_HINT) : null,
        ...opts.errors.map((e) => h('p', { class: 'status status-error' }, e)),
      ),
      mapBox,
      list,
    ),
    h('footer', { class: 'review-foot' }, status, h('div', { class: 'actions' }, save, cancel)),
  );

  let map: ReviewMap | null = null;

  const groupLabel = (i: number): string => {
    const g = groups[i] as ReviewGroup;
    return `${i + 1}${g.title ? ` · ${g.title}` : ''}`;
  };

  /** Переложить фото: в группу с номером index или в неразобранные (-1). */
  function move(key: string, index: number): void {
    groups = groups.map((g) => ({ ...g, keys: g.keys.filter((k) => k !== key) }));
    unsorted = unsorted.filter((k) => k !== key);
    if (index < 0) unsorted.push(key);
    else groups[index]?.keys.push(key);
    // Новые точки, оставшиеся без фото, не нужны.
    groups = groups.filter((g) => g.keys.length || g.pointId);
    render();
  }

  function thumb(key: string, current: number): HTMLElement {
    const e = entries.get(key) as ReviewEntry;
    const select = h('select', { class: 'review-move', 'aria-label': 'Куда положить' });
    groups.forEach((_, i) => {
      select.append(
        h('option', { value: String(i), selected: i === current }, `→ ${groupLabel(i)}`),
      );
    });
    select.append(h('option', { value: '-1', selected: current === -1 }, '→ Неразобранные'));
    select.addEventListener('change', () => move(key, Number(select.value)));

    const flags = [
      e.kind === 'video' ? 'видео' : null,
      e.placement.far ? 'далеко от маршрута' : null,
      e.approx ? 'время примерное' : null,
      current === -1 && e.placement.outside ? 'снято вне похода' : null,
      current === -1 && !e.placement.outside && e.placement.pos === null
        ? 'нет времени и места'
        : null,
    ].filter((f): f is string => f !== null);

    const fig = h(
      'figure',
      { class: 'review-thumb', draggable: 'true', title: e.name },
      h('img', { src: e.thumbUrl, alt: e.name, loading: 'lazy' }),
      flags.length ? h('figcaption', {}, flags.join(' · ')) : null,
      select,
    );
    fig.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/plain', key);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    return fig;
  }

  /** Карточка-приёмник: на компьютере фото можно перетащить мышью. */
  function dropTarget(el: HTMLElement, index: number): void {
    el.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      el.classList.add('drop-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('drop-over');
      const key = ev.dataTransfer?.getData('text/plain');
      if (key && entries.has(key)) move(key, index);
    });
  }

  function render(): void {
    const placed = groups.reduce((s, g) => s + g.keys.length, 0);
    const newPoints = groups.filter((g) => !g.pointId && g.keys.length).length;
    summary.textContent =
      `${opts.entries.length} ${plural(opts.entries.length, ['файл', 'файла', 'файлов'])}: ` +
      `${placed} на маршруте, ${unsorted.length} в неразобранных. ` +
      `Новых точек: ${newPoints}.`;

    list.replaceChildren(
      ...groups.map((g, i) => {
        const titleField = g.pointId
          ? h('strong', {}, g.title || 'Точка без названия')
          : (() => {
              const input = h('input', {
                type: 'text',
                value: g.title,
                maxlength: String(POINT_TITLE_MAX),
                placeholder: `Новая точка ${i + 1}`,
                'aria-label': `Название точки ${i + 1}`,
              });
              input.addEventListener('change', () => {
                g.title = input.value.trim();
                map?.setMarkers(markers());
              });
              return input;
            })();
        const card = h(
          'section',
          { class: 'review-group', id: `review-group-${i}` },
          h(
            'div',
            { class: 'review-group-head' },
            h('span', { class: `review-num${g.pointId ? ' existing' : ''}` }, String(i + 1)),
            titleField,
            h(
              'span',
              { class: 'muted small-text' },
              `${opts.km(g.pos)}${g.pointId ? ' · уже есть' : ' · новая'}`,
            ),
          ),
          h('div', { class: 'review-thumbs' }, ...g.keys.map((k) => thumb(k, i))),
        );
        dropTarget(card, i);
        return card;
      }),
      (() => {
        const card = h(
          'section',
          { class: 'review-group review-unsorted' },
          h(
            'div',
            { class: 'review-group-head' },
            h('strong', {}, `Неразобранные (${unsorted.length})`),
            h('span', { class: 'muted small-text' }, 'потом можно бросить на трек из лотка'),
          ),
          h('div', { class: 'review-thumbs' }, ...unsorted.map((k) => thumb(k, -1))),
        );
        dropTarget(card, -1);
        return card;
      })(),
    );
    map?.setMarkers(markers());
  }

  const markers = (): { pos: number; label: string; existing: boolean }[] =>
    groups.map((g, i) => ({ pos: g.pos, label: String(i + 1), existing: g.pointId !== null }));

  function close(): void {
    openCount--;
    map?.destroy();
    root.remove();
    document.body.classList.remove('review-open');
    opts.onClose();
  }

  cancel.addEventListener('click', () => {
    if (window.confirm('Отменить раскладку? Ничего не загрузится.')) close();
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    cancel.disabled = true;
    status.className = 'status';
    try {
      await opts.onSave(
        { groups: groups.filter((g) => g.keys.length), unsorted },
        (text) => (status.textContent = text),
      );
      close();
    } catch (err) {
      status.className = 'status status-error';
      status.textContent = `Не получилось сохранить: ${errorText(err)}`;
      save.disabled = false;
      cancel.disabled = false;
    }
  });

  openCount++;
  document.body.classList.add('review-open');
  document.body.append(root);
  try {
    map = createReviewMap(mapBox, opts.track, opts.bbox, (i) =>
      document.getElementById(`review-group-${i}`)?.scrollIntoView({ behavior: 'smooth' }),
    );
  } catch {
    mapBox.remove();
  }
  render();
}
