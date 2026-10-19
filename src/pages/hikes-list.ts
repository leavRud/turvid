import { signOut } from '../api/auth';
import { listHikes } from '../api/hikes';
import type { HikeSummary } from '../types';
import { h } from '../ui/dom';

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
      // Импорт трека появится на этапе 2.
      h(
        'button',
        { type: 'button', class: 'btn btn-primary', disabled: true, title: 'Скоро' },
        'Новый поход',
      ),
      list,
    ),
  );

  try {
    const hikes = await listHikes();
    list.replaceChildren(...(hikes.length ? hikes.map(hikeCard) : [emptyState()]));
  } catch (err) {
    list.replaceChildren(
      h(
        'p',
        { class: 'status status-error' },
        `Не удалось загрузить походы: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}

function emptyState(): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('p', {}, 'Пока нет ни одного похода.'),
    h('p', { class: 'muted' }, 'Загрузи трек из часов или телефона — он появится здесь.'),
  );
}

function hikeCard(hike: HikeSummary): HTMLElement {
  const km = (hike.distance_m / 1000).toFixed(1).replace('.', ',');
  return h(
    'article',
    { class: 'hike-card' },
    h('h2', {}, hike.title),
    h('p', { class: 'muted' }, `${km} км`),
  );
}
