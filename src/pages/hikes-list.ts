import { signOut } from '../api/auth';
import { deleteHike, listHikes } from '../api/hikes';
import { splitDays } from '../track/days';
import type { HikeListItem } from '../types';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';
import { formatDateRange, formatKm, plural } from '../ui/format';
import { trackSvg } from '../ui/track-svg';

/** Экран «Мои походы». */
export async function renderHikesList(root: HTMLElement, email: string | undefined): Promise<void> {
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
          logout,
        ),
      ),
      h('a', { href: '/new', class: 'btn btn-primary', 'data-link': true }, 'Новый поход'),
      list,
    ),
  );

  async function load(): Promise<void> {
    try {
      const hikes = await listHikes();
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
    const input = h('input', {
      type: 'text',
      'aria-label': 'Название похода',
      autocomplete: 'off',
    });
    const ok = h(
      'button',
      { type: 'submit', class: 'btn btn-danger', disabled: true },
      'Удалить навсегда',
    );
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Отмена');
    const status = h('p', { class: 'status', role: 'status' });
    const form = h(
      'form',
      { class: 'stack', method: 'dialog' },
      h('h2', {}, 'Удалить поход?'),
      h(
        'p',
        {},
        'Трек, точки и все фото удалятся без возможности восстановить. Чтобы подтвердить, введи название: ',
        h('strong', {}, hike.title),
      ),
      input,
      h('div', { class: 'actions' }, ok, cancel),
      status,
    );
    const dialog = h('dialog', { class: 'dialog' }, form);

    input.addEventListener('input', () => {
      ok.disabled = input.value.trim() !== hike.title.trim();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.disabled = true;
      status.className = 'status';
      status.textContent = 'Удаляю…';
      try {
        await deleteHike(hike.id);
        dialog.close();
        await load();
      } catch (err) {
        ok.disabled = false;
        status.className = 'status status-error';
        status.textContent = `Не получилось удалить: ${errorText(err)}`;
      }
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
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
