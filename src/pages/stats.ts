// Экран «Статистика»: итоги за всё время, км по месяцам, рекорды, карта всех маршрутов.

import { listHikes } from '../api/hikes';
import { createAllRoutesMap } from '../map/all-routes-map';
import { navigate } from '../router';
import { computeStats, type Stats } from '../stats/stats';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';
import { formatKm, formatMeters, plural } from '../ui/format';
import type { HikeListItem } from '../types';
import { themeSwitcher } from '../ui/theme';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Столбцы км по месяцам года — свой SVG. */
function monthBars(row: number[]): SVGSVGElement {
  const W = 600;
  const H = 220;
  const top = 24;
  const bottom = 24;
  const max = Math.max(...row, 1);
  const slot = W / 12;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'month-bars',
    role: 'img',
    'aria-label': 'Километры по месяцам',
  });
  row.forEach((m, i) => {
    const hgt = (m / max) * (H - top - bottom);
    const x = i * slot + slot * 0.18;
    const w = slot * 0.64;
    const y = H - bottom - hgt;
    if (m > 0) {
      svg.append(svgEl('rect', { x, y, width: w, height: Math.max(hgt, 2), rx: 3, class: 'bar' }));
      const label = svgEl('text', { x: x + w / 2, y: y - 6, class: 'bar-value' });
      label.textContent = String(Math.round(m / 1000));
      svg.append(label);
    }
    const month = svgEl('text', { x: x + w / 2, y: H - 6, class: 'bar-month' });
    month.textContent = MONTHS[i] ?? '';
    svg.append(month);
  });
  svg.append(svgEl('line', { x1: 0, x2: W, y1: H - bottom, y2: H - bottom, class: 'bar-axis' }));
  return svg;
}

function render(root: HTMLElement, stats: Stats, mapBox: HTMLElement): void {
  const { totals, records } = stats;
  let year = stats.years[0] ?? new Date().getFullYear();

  const bars = h('div', { class: 'card' });
  const yearButtons = h('div', { class: 'strip-modes', role: 'group', 'aria-label': 'Год' });
  const drawYear = (): void => {
    const row = stats.monthly.get(year) ?? new Array<number>(12).fill(0);
    const sum = row.reduce((s, x) => s + x, 0);
    bars.replaceChildren(
      monthBars(row),
      h(
        'p',
        { class: 'muted small-text' },
        `За ${year} год: ${formatKm(sum)}. Числа над столбцами — км.`,
      ),
    );
    yearButtons.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset['year'] === String(year)));
    });
  };
  for (const y of stats.years) {
    const b = h(
      'button',
      { type: 'button', class: 'strip-mode', 'data-year': String(y) },
      String(y),
    );
    b.addEventListener('click', () => {
      year = y;
      drawYear();
    });
    yearButtons.append(b);
  }
  drawYear();

  const link = (id: string, text: string): HTMLElement =>
    h('a', { href: `/hikes/${id}`, 'data-link': true }, text);
  const recordRows: [string, HTMLElement | string][] = [
    [
      'Самый длинный поход',
      records.longestHike
        ? h(
            'span',
            {},
            link(records.longestHike.id, records.longestHike.title),
            ` — ${formatKm(records.longestHike.distanceM)}`,
          )
        : '—',
    ],
    [
      'Самый длинный день',
      records.longestDay
        ? h(
            'span',
            {},
            link(records.longestDay.id, records.longestDay.title),
            `, день ${records.longestDay.day} — ${formatKm(records.longestDay.distanceM)}`,
          )
        : '—',
    ],
    [
      'Самый большой перепад высот',
      records.biggestRange
        ? h(
            'span',
            {},
            link(records.biggestRange.id, records.biggestRange.title),
            ` — ${formatMeters(records.biggestRange.rangeM)}`,
          )
        : 'нет походов с надёжной высотой',
    ],
  ];

  const totalsRows: [string, string][] = [
    ['Походы', String(totals.hikes)],
    ['Пройдено', formatKm(totals.distanceM)],
    ['Дни', String(totals.days)],
    [plural(totals.nights, ['Ночёвка', 'Ночёвки', 'Ночёвок']), String(totals.nights)],
    ['Фото и видео', String(totals.photos)],
  ];

  root.replaceChildren(
    h(
      'main',
      { class: 'page stats-page' },
      h(
        'header',
        { class: 'page-header' },
        h('h1', {}, 'Статистика'),
        h(
          'div',
          { class: 'header-actions' },
          themeSwitcher(),
          h('a', { href: '/', class: 'btn btn-ghost', 'data-link': true }, '← Мои походы'),
        ),
      ),
      h(
        'dl',
        { class: 'stats' },
        ...totalsRows.map(([k, v]) => h('div', { class: 'stat' }, h('dt', {}, k), h('dd', {}, v))),
      ),
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Километры по месяцам'),
        stats.years.length > 1 ? yearButtons : null,
        bars,
      ),
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Рекорды'),
        h(
          'dl',
          { class: 'records' },
          ...recordRows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
        ),
      ),
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Все маршруты'),
        mapBox,
        h('p', { class: 'muted small-text' }, 'Нажми на трек — откроется поход.'),
      ),
    ),
  );
}

export async function renderStats(
  root: HTMLElement,
  isCurrent: () => boolean = () => true,
): Promise<() => void> {
  document.title = 'Статистика — Turvid';
  root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'muted' }, 'Считаю…')));
  try {
    const hikes = await listHikes();
    if (!isCurrent()) return () => undefined;
    if (!hikes.length) {
      root.replaceChildren(
        h(
          'main',
          { class: 'page page-narrow' },
          h('h1', {}, 'Статистика'),
          h('p', { class: 'muted' }, 'Пока нечего считать — загрузи первый поход.'),
          h('a', { href: '/', class: 'btn btn-ghost', 'data-link': true }, '← Мои походы'),
        ),
      );
      return () => (document.title = 'Turvid');
    }
    return mountStats(root, hikes);
  } catch (err) {
    if (!isCurrent()) return () => undefined;
    root.replaceChildren(
      h(
        'main',
        { class: 'page' },
        h('p', { class: 'status status-error' }, `Не удалось посчитать: ${errorText(err)}`),
      ),
    );
    return () => undefined;
  }
}

/** Рисует статистику по уже загруженным походам. Возвращает уборку. */
export function mountStats(root: HTMLElement, hikes: HikeListItem[]): () => void {
  const mapBox = h('div', { class: 'stats-map' });
  render(root, computeStats(hikes), mapBox);
  let stopMap: () => void = () => undefined;
  try {
    stopMap = createAllRoutesMap(mapBox, hikes, (id) => navigate(`/hikes/${id}`));
  } catch (err) {
    mapBox.replaceChildren(
      h('p', { class: 'map-error' }, `Карта не загрузилась: ${errorText(err)}`),
    );
  }
  return () => {
    stopMap();
    document.title = 'Turvid';
  };
}
