// Меню похода: поделиться, скачать исходный файл, удалить. Название правится кнопкой ✎ в шапке.

import { deleteHike, setShareToken, sourceDownloadUrl } from '../api/hikes';
import { newShareToken, shareUrl } from '../api/share';
import { navigate } from '../router';
import type { Hike } from '../types';
import { openDeleteHikeDialog } from '../ui/delete-dialog';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';

export interface MenuHandlers {
  /** Текущее название — для имени скачанного файла и подтверждения удаления. */
  title(): string;
}

/** Копирует текст; если буфер обмена недоступен — выделяет поле, чтобы скопировать руками. */
async function copy(text: string, field: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field.focus();
    field.select();
    return false;
  }
}

export function createHikeMenu(hike: Hike, handlers: MenuHandlers): HTMLElement {
  let token = hike.share_token;
  const status = h('p', { class: 'status', role: 'status' });
  const fail = (what: string, err: unknown): void => {
    status.className = 'status status-error';
    status.textContent = `${what}: ${errorText(err)}`;
  };

  // Поделиться
  const shareToggle = h('input', {
    type: 'checkbox',
    checked: token !== null,
    'aria-label': 'Ссылка для просмотра без входа',
  });
  const linkField = h('input', { type: 'text', readonly: true, 'aria-label': 'Ссылка на поход' });
  const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Скопировать');
  const linkRow = h('div', { class: 'menu-row' }, linkField, copyBtn);
  const shareNote = h(
    'p',
    { class: 'muted small-text' },
    'По ссылке поход откроется без входа и без кнопок правки. Выключишь — ссылка перестанет работать; включишь снова — будет новая.',
  );
  const renderShare = (): void => {
    shareToggle.checked = token !== null;
    linkRow.hidden = token === null;
    linkField.value = token ? shareUrl(token) : '';
  };
  shareToggle.addEventListener('change', async () => {
    shareToggle.disabled = true;
    const next = shareToggle.checked ? newShareToken() : null;
    try {
      await setShareToken(hike.id, next);
      token = next;
      status.className = 'status';
      status.textContent = next
        ? 'Ссылка включена.'
        : 'Ссылка выключена — старая больше не работает.';
    } catch (err) {
      fail('Не получилось поменять ссылку', err);
    } finally {
      shareToggle.disabled = false;
      renderShare();
    }
  });
  copyBtn.addEventListener('click', async () => {
    if (!token) return;
    const ok = await copy(shareUrl(token), linkField);
    status.className = 'status';
    status.textContent = ok ? 'Ссылка скопирована.' : 'Скопируй ссылку из поля.';
  });
  renderShare();

  // Скачать исходный файл
  const download = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Скачать исходный файл');
  download.hidden = !hike.source_path;
  download.addEventListener('click', async () => {
    if (!hike.source_path) return;
    try {
      const ext = hike.source_path.split('.').pop() ?? 'gpx';
      const url = await sourceDownloadUrl(hike.source_path, `${handlers.title()}.${ext}`);
      const a = h('a', { href: url, download: `${handlers.title()}.${ext}` });
      document.body.append(a);
      a.click();
      a.remove();
    } catch (err) {
      fail('Не получилось скачать', err);
    }
  });

  // Удалить
  const remove = h('button', { type: 'button', class: 'btn btn-danger' }, 'Удалить поход');
  remove.addEventListener('click', () =>
    openDeleteHikeDialog(handlers.title(), async () => {
      await deleteHike(hike.id);
      navigate('/');
    }),
  );

  return h(
    'details',
    { class: 'hike-menu' },
    h('summary', { class: 'btn btn-ghost btn-small' }, 'Меню'),
    h(
      'div',
      { class: 'hike-menu-panel stack' },
      h(
        'div',
        { class: 'stack' },
        h('label', { class: 'check' }, shareToggle, 'Ссылка для просмотра без входа'),
        linkRow,
        shareNote,
      ),
      h('div', { class: 'actions' }, download, remove),
      status,
    ),
  );
}
