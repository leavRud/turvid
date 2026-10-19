// Публичный просмотр похода по ссылке /s/<token>: тот же экран, но без правки, меню и лотка.

import { fetchSharedHike } from '../api/share';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';
import { mountHikeView } from './hike-view';

export async function renderSharedHike(
  root: HTMLElement,
  token: string,
  isCurrent: () => boolean = () => true,
): Promise<() => void> {
  root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'muted' }, 'Загружаю поход…')));
  try {
    const bundle = await fetchSharedHike(token);
    if (!isCurrent()) return () => undefined;
    if (!bundle) {
      document.title = 'Ссылка не работает — Turvid';
      root.replaceChildren(
        h(
          'main',
          { class: 'page page-narrow' },
          h('h1', {}, 'Ссылка не работает'),
          h('p', { class: 'muted' }, 'Похоже, автор выключил её или прислал неполностью.'),
        ),
      );
      return () => undefined;
    }
    return mountHikeView(root, bundle, { editable: false });
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
}
