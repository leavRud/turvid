// Панель справа (на телефоне — под картой): карточка точки или «где я сейчас», список точек, место.

import { POINT_DESCRIPTION_MAX, POINT_TITLE_MAX } from '../api/points';
import type { StorageUsage } from '../api/media';
import { ZIP_ACCEPT } from '../photos/zip';
import type { PositionStore } from '../player/store';
import type { MediaItem, Point } from '../types';
import { h } from '../ui/dom';
import { MEDIA_DRAG_TYPE } from '../ui/drag';
import { errorText } from '../ui/errors';
import { formatBytes, formatClock, formatKm, plural } from '../ui/format';

/** Позиция ближе этого к точке — стоим на точке, м. */
const ON_POINT_M = 0.5;
/** Бесплатно в Supabase Storage — 1 ГБ. */
const SUPABASE_QUOTA_BYTES = 1024 ** 3;

/** «3 файла»: в лотке и фото, и видео. */
const photosText = (n: number): string => `${n} ${plural(n, ['файл', 'файла', 'файлов'])}`;
/** Примерная цена горячего хранения в VK Cloud, ₽ за ГБ в месяц (сверить с прайсом). */
const S3_RUB_PER_GB_MONTH = 2.3;

export interface PlaceInfo {
  km: string;
  day: string;
  time: string | null;
  date: string | null;
  ele: string | null;
  multiDay: boolean;
}

export interface UploadReport {
  uploaded: number;
  errors: string[];
  warnings: string[];
  seconds: number;
}

export interface PanelContext {
  store: PositionStore;
  editable: boolean;
  points(): Point[];
  mediaOf(pointId: string): MediaItem[];
  /** Неразобранные фото (лоток). */
  unsorted(): MediaItem[];
  describe(pos: number): PlaceInfo;
  /** Загрузить фото в поход с автораскладкой и экраном проверки. */
  autoUpload(files: File[]): void;
  /** Положить фото из лотка на трек в текущее место. */
  placeHere(media: MediaItem): Promise<void>;
  /** Удалить насовсем (из лотка — сразу несколько). */
  removeMedia(media: MediaItem[]): Promise<void>;
  openUnsorted(index: number): void;
  createPointHere(): Promise<Point>;
  savePoint(
    point: Point,
    fields: { title: string; description: string },
    order: MediaItem[],
    removed: MediaItem[],
  ): Promise<void>;
  deletePoint(point: Point): Promise<void>;
  upload(
    point: Point,
    files: File[],
    progress: (done: number, total: number) => void,
  ): Promise<UploadReport>;
  openMedia(point: Point, index: number): void;
  storage(): Promise<StorageUsage>;
}

export interface Panel {
  element: HTMLElement;
  /** Позиция или данные поменялись. */
  update(): void;
  /** Перерисовать карточку, даже если стоим на той же точке. */
  refresh(): void;
  /** Открыть правку точки (после создания). */
  edit(pointId: string): void;
  refreshStorage(): void;
}

export function createPanel(ctx: PanelContext): Panel {
  const body = h('div', { class: 'panel-body' });
  const list = h('div', { class: 'point-list' });
  const storageLine = h('p', { class: 'muted small-text' });
  const tray = h('section', { class: 'tray' });

  // Загрузка в поход целиком: фото сами раскладываются по маршруту, потом — экран проверки.
  const autoInput = h('input', {
    type: 'file',
    multiple: true,
    accept: 'image/*,video/*,.heic,.heif',
    class: 'visually-hidden',
  });
  // ZIP — отдельной кнопкой: с .zip в общем accept Android открывает не галерею, а файлы.
  const zipInput = h('input', {
    type: 'file',
    multiple: true,
    accept: ZIP_ACCEPT,
    class: 'visually-hidden',
  });
  for (const input of [autoInput, zipInput]) {
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) ctx.autoUpload(files);
    });
  }
  const autoButton = ctx.editable
    ? h(
        'div',
        { class: 'stack upload-all' },
        h(
          'div',
          { class: 'actions' },
          h('label', { class: 'btn btn-primary' }, 'Загрузить фото и видео в поход', autoInput),
          h('label', { class: 'btn btn-ghost' }, 'Из ZIP-архива', zipInput),
        ),
        h(
          'p',
          { class: 'muted small-text' },
          'Фото и видео сами встанут на маршрут по времени и месту съёмки — перед сохранением можно поправить. Видео — MP4, MOV или WebM до 50 МБ, можно и ZIP-архивом.',
        ),
      )
    : null;

  const element = h(
    'aside',
    { class: 'hike-panel' },
    body,
    autoButton,
    tray,
    h('h2', { class: 'section-title' }, 'Точки'),
    list,
    storageLine,
  );

  /** Выбранные в лотке фото (id): можно несколько — положить или удалить разом. */
  const selectedTray = new Set<string>();

  /** Что сейчас нарисовано в body: точка (id), правка точки или «между точками». */
  let shown: string | null = null;
  let editing: string | null = null;
  /** Точку только что поставили и сразу открыли правку: отмена её убирает, если она пустая. */
  let fresh: string | null = null;
  /** Идёт загрузка в эту точку — её карточку не перерисовываем. */
  let uploadingTo: string | null = null;
  const now = { km: h('dd', {}), day: h('dd', {}), time: h('dd', {}), ele: h('dd', {}) };

  const currentPoint = (): Point | null => {
    const pos = ctx.store.get();
    return ctx.points().find((p) => Math.abs(p.pos_m - pos) < ON_POINT_M) ?? null;
  };

  function renderBetween(): void {
    const info = ctx.describe(ctx.store.get());
    const create = h(
      'button',
      { type: 'button', class: 'btn btn-primary' },
      'Поставить точку здесь',
    );
    const status = h('p', { class: 'status', role: 'status' });
    create.addEventListener('click', async () => {
      create.disabled = true;
      try {
        const point = await ctx.createPointHere();
        editing = fresh = point.id;
        update(true);
      } catch (err) {
        status.className = 'status status-error';
        status.textContent = `Не получилось поставить точку: ${errorText(err)}`;
        create.disabled = false;
      }
    });
    body.replaceChildren(
      h(
        'div',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Сейчас'),
        h(
          'dl',
          { class: 'now' },
          h('div', {}, h('dt', {}, 'Километр'), now.km),
          info.multiDay ? h('div', {}, h('dt', {}, 'День'), now.day) : null,
          info.time !== null ? h('div', {}, h('dt', {}, 'Время'), now.time) : null,
          info.ele !== null ? h('div', {}, h('dt', {}, 'Высота'), now.ele) : null,
        ),
        ctx.editable ? create : null,
        ctx.editable
          ? h('p', { class: 'muted small-text' }, 'Или долго нажми на карту у нужного места.')
          : null,
        status,
      ),
    );
    updateNow();
  }

  function updateNow(): void {
    const info = ctx.describe(ctx.store.get());
    const day = info.day.charAt(0).toUpperCase() + info.day.slice(1);
    now.km.textContent = info.km;
    now.day.textContent = info.date ? `${day}, ${info.date}` : day;
    now.time.textContent = info.time ?? '—';
    now.ele.textContent = info.ele ?? '—';
  }

  function thumbButton(m: MediaItem, onClick: () => void, cls = 'thumb'): HTMLElement {
    const b = h(
      'button',
      { type: 'button', class: cls, 'aria-label': m.kind === 'video' ? 'Видео' : 'Фото' },
      h('img', { src: m.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' }),
      m.kind === 'video'
        ? h('span', { class: 'thumb-badge' }, `▶ ${m.duration_s ? formatClock(m.duration_s) : ''}`)
        : null,
    );
    b.addEventListener('click', onClick);
    return b;
  }

  function renderPoint(point: Point): void {
    const media = ctx.mediaOf(point.id);
    const info = ctx.describe(point.pos_m);
    const meta = [
      info.km,
      info.date && info.time ? `${info.date}, ${info.time}` : info.time,
      info.ele,
    ]
      .filter(Boolean)
      .join(' · ');

    const [first, ...rest] = media;
    const main = first ? thumbButton(first, () => ctx.openMedia(point, 0), 'point-main') : null;
    if (main && first?.kind === 'photo') {
      // Главное фото — в полном размере, превью только пока грузится.
      const img = main.querySelector('img');
      if (img) img.src = first.url;
    }

    const status = h('p', { class: 'status', role: 'status' });
    const actions = ctx.editable ? pointActions(point, status) : null;

    body.replaceChildren(
      h(
        'article',
        { class: 'point-card' },
        main,
        rest.length
          ? h(
              'div',
              { class: 'thumbs' },
              ...rest.map((m, i) => thumbButton(m, () => ctx.openMedia(point, i + 1))),
            )
          : null,
        h('h2', { class: 'point-card-title' }, point.title || 'Без названия'),
        point.description ? h('p', { class: 'point-description' }, point.description) : null,
        h('p', { class: 'muted' }, meta),
        actions,
        status,
      ),
    );
  }

  function pointActions(point: Point, status: HTMLElement): HTMLElement {
    // Без accept по расширениям: на Android такой фильтр прячет файлы; image/* и video/* открывают галерею.
    const input = h('input', {
      type: 'file',
      multiple: true,
      accept: 'image/*,video/*,.heic,.heif',
      class: 'visually-hidden',
    });
    const add = h('label', { class: 'btn btn-primary' }, 'Добавить фото или видео', input);
    const edit = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Изменить');
    const del = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Удалить точку');

    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) void runUpload(point, files, status);
    });
    edit.addEventListener('click', () => {
      editing = point.id;
      fresh = null;
      update(true);
    });
    del.addEventListener('click', async () => {
      const count = ctx.mediaOf(point.id).length;
      const what = point.title ? `«${point.title}»` : 'без названия';
      const note = count ? ` Её фото (${count}) станут неразобранными.` : '';
      if (!window.confirm(`Удалить точку ${what}?${note}`)) return;
      try {
        await ctx.deletePoint(point);
      } catch (err) {
        status.className = 'status status-error';
        status.textContent = `Не получилось удалить: ${errorText(err)}`;
      }
    });

    const box = h('div', { class: 'actions' }, add, edit, del);
    return box;
  }

  async function runUpload(point: Point, files: File[], status: HTMLElement): Promise<void> {
    uploadingTo = point.id;
    const bar = h('progress', { max: String(files.length), value: '0', class: 'upload-progress' });
    const text = h(
      'span',
      {},
      `Готовлю ${files.length} ${files.length === 1 ? 'файл' : 'файлов'}…`,
    );
    status.className = 'status';
    status.replaceChildren(text, bar);
    try {
      const report = await ctx.upload(point, files, (done, total) => {
        bar.value = done;
        text.textContent = `Загружено ${done} из ${total}`;
      });
      uploadingTo = null;
      update(true);
      // Карточку перерисовали — итог пишем в новый статус.
      const fresh = body.querySelector('.point-card .status');
      if (!fresh) return;
      const lines = [
        `Загружено ${report.uploaded} из ${files.length} за ${Math.round(report.seconds)} с.`,
        ...report.warnings,
        ...report.errors,
      ];
      fresh.className = report.errors.length ? 'status status-error' : 'status';
      fresh.replaceChildren(...lines.map((l) => h('span', { class: 'status-line' }, l)));
    } catch (err) {
      uploadingTo = null;
      status.className = 'status status-error';
      status.textContent = `Загрузка прервалась: ${errorText(err)}`;
    }
  }

  function renderEdit(point: Point): void {
    let order = [...ctx.mediaOf(point.id)];
    const removed: MediaItem[] = [];
    const title = h('input', {
      type: 'text',
      maxlength: String(POINT_TITLE_MAX),
      value: point.title,
      placeholder: 'Например, «Родник»',
      'aria-label': 'Название точки',
    });
    const description = h('textarea', {
      maxlength: String(POINT_DESCRIPTION_MAX),
      rows: '6',
      placeholder: 'Что здесь было',
      'aria-label': 'Описание точки',
    });
    description.value = point.description;
    const counter = h('span', { class: 'muted small-text' });
    const updateCounter = (): void => {
      counter.textContent = `${description.value.length} / ${POINT_DESCRIPTION_MAX}`;
    };
    description.addEventListener('input', updateCounter);
    updateCounter();

    const mediaBox = h('div', { class: 'edit-media' });
    const renderMedia = (): void => {
      mediaBox.replaceChildren(
        ...order.map((m, i) => {
          const left = h(
            'button',
            { type: 'button', class: 'mini-btn', 'aria-label': 'Левее', disabled: i === 0 },
            '←',
          );
          const right = h(
            'button',
            {
              type: 'button',
              class: 'mini-btn',
              'aria-label': 'Правее',
              disabled: i === order.length - 1,
            },
            '→',
          );
          const drop = h(
            'button',
            { type: 'button', class: 'mini-btn', 'aria-label': 'Удалить' },
            '✕',
          );
          const swap = (j: number): void => {
            const next = [...order];
            [next[i], next[j]] = [next[j] as MediaItem, next[i] as MediaItem];
            order = next;
            renderMedia();
          };
          left.addEventListener('click', () => swap(i - 1));
          right.addEventListener('click', () => swap(i + 1));
          drop.addEventListener('click', () => {
            removed.push(m);
            order = order.filter((x) => x !== m);
            renderMedia();
          });
          return h(
            'div',
            { class: 'edit-thumb' },
            h('img', { src: m.thumbUrl, alt: '', loading: 'lazy' }),
            h('div', { class: 'edit-thumb-actions' }, left, right, drop),
          );
        }),
      );
    };
    renderMedia();

    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Сохранить');
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Отмена');
    const status = h('p', { class: 'status', role: 'status' });
    const form = h(
      'form',
      { class: 'stack point-edit' },
      h('h2', { class: 'section-title' }, 'Точка'),
      h('label', { class: 'field' }, h('span', {}, 'Название'), title),
      h('label', { class: 'field' }, h('span', {}, 'Описание'), description, counter),
      order.length ? h('div', { class: 'field' }, h('span', {}, 'Фото — порядок'), mediaBox) : null,
      h('div', { class: 'actions' }, save, cancel),
      status,
    );
    cancel.addEventListener('click', async () => {
      const empty =
        point.id === fresh &&
        !point.title &&
        !point.description &&
        ctx.mediaOf(point.id).length === 0;
      editing = fresh = null;
      if (!empty) {
        update(true);
        return;
      }
      // Пустую точку, которую только что поставили, в базе не оставляем.
      cancel.disabled = save.disabled = true;
      try {
        await ctx.deletePoint(point);
      } catch (err) {
        update(true);
        const card = body.querySelector('.point-card .status');
        if (card) {
          card.className = 'status status-error';
          card.textContent = `Не получилось убрать пустую точку: ${errorText(err)}`;
        }
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (removed.length && !window.confirm(`Удалить ${removed.length} фото насовсем?`)) return;
      save.disabled = true;
      status.className = 'status';
      status.textContent = 'Сохраняю…';
      try {
        await ctx.savePoint(
          point,
          { title: title.value.trim(), description: description.value },
          order,
          removed,
        );
        editing = fresh = null;
        update(true);
      } catch (err) {
        save.disabled = false;
        status.className = 'status status-error';
        status.textContent = `Не получилось сохранить: ${errorText(err)}`;
      }
    });
    body.replaceChildren(form);
    title.focus();
  }

  /** Что сейчас нарисовано в списке и лотке — чтобы не пересобирать их на каждый кадр. */
  let listKey = '';
  let trayKey = '';
  const placeHereBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Положить сюда');

  function renderTray(): void {
    // Лоток неразобранных — только у владельца, по публичной ссылке его нет.
    if (!ctx.editable) return;
    const items = ctx.unsorted();
    const ids = new Set(items.map((m) => m.id));
    for (const id of [...selectedTray]) if (!ids.has(id)) selectedTray.delete(id);
    const selected = items.filter((m) => selectedTray.has(m.id));
    const n = selected.length;
    placeHereBtn.textContent = `Положить сюда${n > 1 ? ` ${n}` : ''} · ${formatKm(ctx.store.get())}`;
    const key = `${items.map((m) => m.id).join(',')}|${[...selectedTray].join(',')}`;
    if (key === trayKey) return;
    trayKey = key;
    if (!items.length) {
      tray.replaceChildren();
      return;
    }
    const status = h('p', { class: 'status', role: 'status' });
    const run = async (text: string, action: () => Promise<void>): Promise<void> => {
      status.className = 'status';
      status.textContent = text;
      try {
        await action();
      } catch (err) {
        status.className = 'status status-error';
        status.textContent = errorText(err);
      }
    };
    /** Удалить насовсем — после подтверждения. */
    const remove = (list: MediaItem[], question: string): void => {
      if (!window.confirm(question)) return;
      void run(`Удаляю ${photosText(list.length)}…`, async () => {
        await ctx.removeMedia(list);
        for (const m of list) selectedTray.delete(m.id);
      });
    };
    placeHereBtn.onclick = n
      ? () =>
          void run('Сохраняю…', async () => {
            for (const m of selected) {
              await ctx.placeHere(m);
              selectedTray.delete(m.id);
            }
          })
      : null;
    const open = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Открыть');
    const first = selected[0];
    if (first) open.addEventListener('click', () => ctx.openUnsorted(items.indexOf(first)));
    const del = h(
      'button',
      { type: 'button', class: 'btn btn-ghost' },
      n > 1 ? `Удалить выбранные (${n})` : 'Удалить',
    );
    del.addEventListener('click', () =>
      remove(selected, n > 1 ? `Удалить ${photosText(n)} насовсем?` : 'Удалить это фото насовсем?'),
    );
    const allSelected = n === items.length;
    const selectAll = h(
      'button',
      { type: 'button', class: 'btn btn-ghost' },
      allSelected ? 'Снять выбор' : 'Выбрать все',
    );
    selectAll.addEventListener('click', () => {
      if (allSelected) selectedTray.clear();
      else for (const m of items) selectedTray.add(m.id);
      renderTray();
    });
    const delAll = h(
      'button',
      { type: 'button', class: 'btn btn-ghost btn-ghost-danger' },
      `Удалить все (${items.length})`,
    );
    delAll.addEventListener('click', () =>
      remove(items, `Удалить все неразобранные — ${photosText(items.length)} — насовсем?`),
    );
    tray.replaceChildren(
      h('h2', { class: 'section-title' }, `Неразобранные (${items.length})`),
      h(
        'div',
        { class: 'thumbs' },
        ...items.map((m) => {
          const b = h(
            'button',
            {
              type: 'button',
              class: 'thumb tray-thumb',
              draggable: 'true',
              'aria-pressed': String(selectedTray.has(m.id)),
              'aria-label': m.kind === 'video' ? 'Выбрать видео' : 'Выбрать фото',
            },
            h('img', { src: m.thumbUrl, alt: '', loading: 'lazy', draggable: 'false' }),
          );
          b.addEventListener('click', () => {
            if (!selectedTray.delete(m.id)) selectedTray.add(m.id);
            renderTray();
          });
          // На компьютере фото можно перетащить прямо на трек.
          b.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData(MEDIA_DRAG_TYPE, m.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          });
          return b;
        }),
      ),
      n
        ? h('div', { class: 'actions' }, placeHereBtn, n === 1 ? open : null, del)
        : h(
            'p',
            { class: 'muted small-text' },
            'Выбери фото (можно несколько) и поставь стрелку на место — или перетащи фото на трек на карте.',
          ),
      h('div', { class: 'actions' }, selectAll, delAll),
      status,
    );
  }

  function renderList(): void {
    const pos = ctx.store.get();
    const points = ctx.points();
    renderTray();
    const key = points
      .map(
        (p) =>
          `${p.id}:${p.title}:${p.pos_m}:${ctx.mediaOf(p.id).length}:${Math.abs(p.pos_m - pos) < ON_POINT_M}`,
      )
      .join('|');
    if (key === listKey) return;
    listKey = key;
    list.replaceChildren(
      ...(points.length
        ? points.map((p) => {
            const count = ctx.mediaOf(p.id).length;
            const b = h(
              'button',
              {
                type: 'button',
                class: 'point-item',
                'aria-current': Math.abs(p.pos_m - pos) < ON_POINT_M ? 'true' : false,
              },
              h('span', { class: 'point-title' }, p.title || 'Без названия'),
              h(
                'span',
                { class: 'muted' },
                `${formatKm(p.pos_m)}${count ? ` · ${count} фото` : ''}`,
              ),
            );
            b.addEventListener('click', () => ctx.store.set(p.pos_m, 'list'));
            return b;
          })
        : [h('p', { class: 'muted' }, 'Точек пока нет.')]),
    );
  }

  /** force — перерисовать карточку, даже если точка та же (данные поменялись). */
  function update(force = false): void {
    const point = currentPoint();
    // Ушли с точки — правка закрывается.
    if (editing && point?.id !== editing) editing = null;
    const target = editing ? `edit:${editing}` : (point?.id ?? null);
    // Пока в точку грузятся фото, карточку с прогрессом не трогаем.
    const busy = uploadingTo !== null && point?.id === uploadingTo;
    if (!busy && (force || target !== shown)) {
      shown = target;
      if (editing && point) renderEdit(point);
      else if (point) renderPoint(point);
      else renderBetween();
    } else if (!point) {
      updateNow();
    }
    renderList();
  }

  function refreshStorage(): void {
    if (!ctx.editable) return;
    ctx
      .storage()
      .then((u) => {
        const pct = (bytes: number, quota: number): number => Math.round((bytes / quota) * 100);
        const parts = [`Место: этот поход ${formatBytes(u.hikeBytes)}`];
        // Фото и видео — в VK Cloud (если подключён; платно, но копейки),
        // треки и старые фото — в Supabase (1 ГБ бесплатно).
        if (u.s3 || u.s3Bytes > 0) {
          const rub = Math.max(1, Math.round((u.s3Bytes / 1024 ** 3) * S3_RUB_PER_GB_MONTH));
          parts.push(`фото и видео ${formatBytes(u.s3Bytes)} (≈ ${rub} ₽ в месяц)`);
        }
        parts.push(
          `${u.s3 ? 'треки' : 'всё'} в Supabase ${formatBytes(u.supabaseBytes)} из 1 ГБ (${pct(u.supabaseBytes, SUPABASE_QUOTA_BYTES)}%)`,
        );
        storageLine.textContent = `${parts.join(' · ')}.`;
      })
      .catch(() => {
        storageLine.textContent = '';
      });
  }

  update(true);
  refreshStorage();

  return {
    element,
    update: () => update(false),
    refresh: () => update(true),
    edit(pointId) {
      editing = fresh = pointId;
      update(true);
    },
    refreshStorage,
  };
}
