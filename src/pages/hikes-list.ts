import { signOut } from '../api/auth';
import { deleteHike, listHikes } from '../api/hikes';
import { splitDays } from '../track/days';
import type { HikeListItem } from '../types';
import { h } from '../ui/dom';
import { openDeleteHikeDialog } from '../ui/delete-dialog';
import { themeSwitcher } from '../ui/theme';
import { errorText } from '../ui/errors';
import { formatDateRange, formatKm, plural } from '../ui/format';
import { trackSvg } from '../ui/track-svg';

/** Экран «Мои походы». */
/** isCurrent — экран ещё на месте; ответ, пришедший после ухода с экрана, не рисуем. */
export async function renderHikesList(
  root: HTMLElement,
  email: string | undefined,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const list = h(
    'section',
    { class: 'hike-list', 'aria-live': 'polite' },
    h('p', { class: 'muted' }, 'Загружаю…'),
  );
  const logout = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Выйти');
  logout.addEventListener('click', () => void signOut());

  root.replaceChildren(
    h(
      'main',
      { class: 'page' },
      h(
        'header',
        { class: 'page-header' },
        h('h1', {}, 'Мои походы'),
        h(
          'div',
          { class: 'header-actions' },
          email ? h('span', { class: 'muted small' }, email) : null,
          themeSwitcher(),
          logout,
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        h('a', { href: '/new', class: 'btn btn-primary', 'data-link': true }, 'Новый поход'),
        h('a', { href: '/stats', class: 'btn btn-ghost', 'data-link': true }, 'Статистика'),
      ),
      list,
    ),
  );

  async function load(): Promise<void> {
    try {
      const hikes = await listHikes();
      if (!isCurrent()) return;
      list.replaceChildren(
        ...(hikes.length ? hikes.map((hike) => hikeCard(hike, confirmDelete)) : [emptyState()]),
      );
    } catch (err) {
      list.replaceChildren(
        h('p', { class: 'status status-error' }, `Не удалось загрузить походы: ${errorText(err)}`),
      );
    }
  }

  /** Удаление с подтверждением вводом названия. */
  function confirmDelete(hike: HikeListItem): void {
    openDeleteHikeDialog(hike.title, async () => {
      await deleteHike(hike.id);
      await load();
    });
  }

  await load();
}

/** Карточка похода: мини-карта, название, даты, км, дни, фото. */
export function hikeCard(hike: HikeListItem, onDelete: (hike: HikeListItem) => void): HTMLElement {
  const days = splitDays(hike.track.t, hike.track.lat.length).length;
  const dates =
    hike.started_at && hike.finished_at
      ? formatDateRange(
          Date.parse(hike.started_at) / 1000,
          Date.parse(hike.finished_at) / 1000,
          hike.timezone,
        )
      : 'Без времени';
  const facts = [
    formatKm(hike.distance_m),
    `${days} ${plural(days, ['день', 'дня', 'дней'])}`,
    `${hike.photos} фото`,
  ].join(' · ');

  const href = `/hikes/${hike.id}`;
  const remove = h('button', { type: 'button', class: 'btn btn-ghost btn-small' }, 'Удалить');
  remove.addEventListener('click', () => onDelete(hike));

  return h(
    'article',
    { class: 'hike-card' },
    h(
      'a',
      { href, class: 'hike-card-map', 'data-link': true, tabindex: '-1', 'aria-hidden': 'true' },
      trackSvg(hike.track, { width: 120, height: 120, maxPoints: 150 }),
    ),
    h(
      'div',
      { class: 'hike-card-body' },
      h('h2', {}, h('a', { href, class: 'hike-card-link', 'data-link': true }, hike.title)),
      h('p', { class: 'muted' }, dates),
      h('p', {}, facts),
      h('div', { class: 'hike-card-actions' }, remove),
    ),
  );
}

function emptyState(): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('p', {}, 'Пока нет ни одного похода.'),
    h('p', { class: 'muted' }, 'Загрузи трек из часов или телефона — он появится здесь.'),
  );
}
