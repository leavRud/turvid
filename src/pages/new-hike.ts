// Экран «Новый поход»: файл → обработка в воркере → превью → название → сохранение.

import { createHike } from '../api/hikes';
import { ImportError } from '../parse/types';
import { navigate } from '../router';
import { summarizeDays } from '../track/days';
import { importTrackFile, type ImportStage } from '../track/import';
import type { ProcessedTrack } from '../track/process';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';
import {
  formatDateRange,
  formatDuration,
  formatKm,
  formatMeters,
  formatShortDate,
  formatSpeed,
  formatTime,
  plural,
} from '../ui/format';
import { trackSvg } from '../ui/track-svg';
import { ZIP_ACCEPT } from '../photos/zip';
import { handOffUpload } from './pending-upload';

const STAGE_TEXT: Record<ImportStage, string> = {
  read: 'Читаю файл…',
  parse: 'Разбираю трек…',
  process: 'Считаю расстояние, дни и остановки…',
};

export function renderNewHike(root: HTMLElement): void {
  const content = h('div', { class: 'stack' });
  const back = h('a', { href: '/', class: 'btn btn-ghost', 'data-link': true }, '← Мои походы');

  root.replaceChildren(
    h(
      'main',
      { class: 'page' },
      h('header', { class: 'page-header' }, h('h1', {}, 'Новый поход'), back),
      content,
    ),
  );

  // Перетаскивание файла в любое место экрана.
  const main = root.firstElementChild as HTMLElement;
  main.addEventListener('dragover', (e) => {
    e.preventDefault();
    main.classList.add('dragging');
  });
  main.addEventListener('dragleave', (e) => {
    if (e.target === main) main.classList.remove('dragging');
  });
  main.addEventListener('drop', (e) => {
    e.preventDefault();
    main.classList.remove('dragging');
    const file = e.dataTransfer?.files[0];
    if (file) void startImport(file);
  });

  function filePicker(label: string): HTMLElement {
    // Без accept: на Android фильтр по расширению часто прячет GPX-файлы.
    const input = h('input', { type: 'file', class: 'visually-hidden' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void startImport(file);
    });
    return h('label', { class: 'btn btn-primary' }, label, input);
  }

  function showPick(): void {
    content.replaceChildren(
      h(
        'div',
        { class: 'dropzone' },
        h('p', {}, 'Перетащи сюда файл трека или выбери его.'),
        filePicker('Выбрать файл'),
        h('p', { class: 'muted small-text' }, 'GPX, KML, KMZ или GeoJSON, до 50 МБ.'),
      ),
    );
  }

  function showError(message: string): void {
    content.replaceChildren(
      h('p', { class: 'status status-error', role: 'alert' }, message),
      filePicker('Выбрать другой файл'),
    );
  }

  async function startImport(file: File): Promise<void> {
    const stage = h('p', { class: 'status', role: 'status' }, 'Готовлю…');
    content.replaceChildren(
      h(
        'div',
        { class: 'progress' },
        h('span', { class: 'spinner' }),
        h('div', {}, h('p', {}, file.name), stage),
      ),
    );
    try {
      const result = await importTrackFile(file, (s) => {
        stage.textContent = STAGE_TEXT[s];
      });
      showPreview(file, result);
    } catch (err) {
      showError(
        err instanceof ImportError
          ? err.message
          : `Не получилось обработать файл: ${errorText(err)}`,
      );
    }
  }

  function showPreview(file: File, r: ProcessedTrack): void {
    const tz = r.timezone;
    const { stats } = r;
    const defaultTitle =
      r.startedAt !== null && r.finishedAt !== null
        ? formatDateRange(r.startedAt, r.finishedAt, tz)
        : file.name.replace(/\.[^.]+$/, '');

    const title = h('input', {
      type: 'text',
      name: 'title',
      maxlength: '120',
      required: true,
      value: defaultTitle,
      'aria-label': 'Название похода',
    });
    const withWaypoints = h('input', { type: 'checkbox', checked: true });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Сохранить');
    const status = h('p', { class: 'status', role: 'status' });

    const rows: [string, string][] = [['Расстояние', formatKm(stats.distanceM)]];
    if (stats.durationS !== null) rows.push(['Всего времени', formatDuration(stats.durationS)]);
    if (stats.movingS !== null) rows.push(['В движении', formatDuration(stats.movingS)]);
    if (stats.movingSpeedKmh !== null)
      rows.push(['Скорость в движении', formatSpeed(stats.movingSpeedKmh)]);
    rows.push(['Дни', String(stats.days)]);
    if (r.startedAt !== null) rows.push(['Остановки от 5 минут', String(stats.stops)]);
    if (stats.elevGainM !== null) rows.push(['Набор высоты', formatMeters(stats.elevGainM)]);
    if (stats.elevRangeM !== null) rows.push(['Перепад высот', formatMeters(stats.elevRangeM)]);

    const days = summarizeDays(r.track).map((d, i) => {
      const when =
        r.startedAt !== null && d.startT !== null && d.endT !== null
          ? `${formatShortDate(r.startedAt + d.startT, tz)}, ${formatTime(r.startedAt + d.startT, tz)}–${formatTime(r.startedAt + d.endT, tz)} · `
          : '';
      return h(
        'li',
        {},
        h('span', { class: `day-dot day-${i % 4}` }),
        `День ${i + 1}: ${when}${formatKm(d.distanceM)}`,
      );
    });

    const waypointsBlock = r.waypoints.length
      ? h(
          'fieldset',
          { class: 'card' },
          h(
            'label',
            { class: 'check' },
            withWaypoints,
            `Добавить метки из файла как точки (${r.waypoints.length})`,
          ),
          h(
            'ul',
            { class: 'plain muted' },
            ...r.waypoints.map((w) =>
              h('li', {}, `${w.name || 'Без названия'} — ${formatKm(w.pos)}`),
            ),
          ),
        )
      : null;

    const form = h(
      'form',
      { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Название'), title),
      waypointsBlock,
      h('div', { class: 'actions' }, save, filePicker('Другой файл')),
      status,
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = title.value.trim();
      if (!name) return;
      save.disabled = true;
      status.className = 'status';
      status.textContent = 'Сохраняю…';
      try {
        const id = await createHike({
          processed: r,
          title: name,
          file,
          withWaypoints: withWaypoints.checked,
        });
        showSaved(id, name);
      } catch (err) {
        save.disabled = false;
        status.className = 'status status-error';
        status.textContent = `Не получилось сохранить: ${errorText(err)}`;
      }
    });

    content.replaceChildren(
      h('div', { class: 'preview-map card' }, trackSvg(r.track, { width: 640, height: 400 })),
      ...r.warnings.map((w) => h('p', { class: 'warning' }, w)),
      h(
        'dl',
        { class: 'stats' },
        ...rows.map(([k, v]) => h('div', { class: 'stat' }, h('dt', {}, k), h('dd', {}, v))),
      ),
      h(
        'section',
        {},
        h(
          'h2',
          { class: 'section-title' },
          `${stats.days} ${plural(stats.days, ['день', 'дня', 'дней'])}`,
        ),
        h('ul', { class: 'plain days' }, ...days),
      ),
      form,
    );
  }

  /** Поход сохранён — сразу предлагаем фото (раздел 7 ТЗ): выбрал файлы — открываем поход с загрузкой. */
  function showSaved(id: string, title: string): void {
    const url = `/hikes/${id}`;
    const input = h('input', {
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
    for (const picker of [input, zipInput]) {
      picker.addEventListener('change', () => {
        const files = [...(picker.files ?? [])];
        picker.value = '';
        if (!files.length) return;
        handOffUpload(id, files);
        navigate(url);
      });
    }
    content.replaceChildren(
      h('p', { class: 'status', role: 'status' }, `Поход «${title}» сохранён.`),
      h(
        'p',
        { class: 'muted' },
        'Теперь добавь фото и видео — они сами встанут на маршрут по времени и месту съёмки, перед сохранением можно поправить.',
      ),
      h(
        'div',
        { class: 'actions' },
        h('label', { class: 'btn btn-primary' }, 'Загрузить фото и видео', input),
        h('label', { class: 'btn btn-ghost' }, 'Из ZIP-архива', zipInput),
        h('a', { href: url, class: 'btn btn-ghost', 'data-link': true }, 'Открыть поход'),
        h('a', { href: '/', class: 'btn btn-ghost', 'data-link': true }, 'К походам'),
      ),
    );
  }

  showPick();
}
