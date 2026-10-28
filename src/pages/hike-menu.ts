// Меню похода «Поделиться»: ссылка для просмотра без входа, скачать исходный файл, удалить.
// Название правится кнопкой ✎ в шапке. Клик мимо меню и Esc его закрывают.

import { deleteHike, setShareToken, sourceDownloadUrl } from '../api/hikes';
import { newShareToken, shareUrl } from '../api/share';
import { navigate } from '../router';
import type { Hike } from '../types';
import { confirmDialog } from '../ui/confirm-dialog';
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

  // Поделиться: переключатель (не галочка) — ссылка включена или нет.
  const shareSwitch = h(
    'button',
    { type: 'button', role: 'switch', class: 'switch' },
    h(
      'span',
      { class: 'switch-track', 'aria-hidden': 'true' },
      h('span', { class: 'switch-knob' }),
    ),
    h('span', {}, 'Ссылка для просмотра без входа'),
  );
  const linkField = h('input', { type: 'text', readonly: true, 'aria-label': 'Ссылка на поход' });
  const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Скопировать');
  const linkRow = h('div', { class: 'menu-row' }, linkField, copyBtn);
  const shareNote = h(
    'p',
    { class: 'muted small-text' },
    'По ссылке поход откроется без входа и без кнопок правки. Выключишь — ссылка перестанет работать (сразу после этого её можно восстановить); включишь заново — будет новая.',
  );
  // Только что выключенная ссылка — её можно вернуть, пока меню открыто на этом экране.
  let removed: string | null = null;
  const restore = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Восстановить ссылку');
  const renderShare = (): void => {
    shareSwitch.setAttribute('aria-checked', String(token !== null));
    linkRow.hidden = token === null;
    linkField.value = token ? shareUrl(token) : '';
    restore.hidden = token !== null || removed === null;
  };
  /** Поставить ссылку (или выключить — null) и сказать, что вышло. */
  const setShare = async (next: string | null, done: string): Promise<void> => {
    shareSwitch.disabled = restore.disabled = true;
    try {
      await setShareToken(hike.id, next);
      if (next === null) removed = token;
      else removed = null;
      token = next;
      status.className = 'status';
      status.textContent = done;
    } catch (err) {
      fail('Не получилось поменять ссылку', err);
    } finally {
      shareSwitch.disabled = restore.disabled = false;
      renderShare();
    }
  };
  shareSwitch.addEventListener('click', async () => {
    if (token === null) {
      await setShare(newShareToken(), 'Ссылка включена.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Выключить ссылку?',
      text: 'Поход перестанет открываться у всех, кому ты отправлял ссылку. Сразу после выключения её можно восстановить.',
      ok: 'Выключить',
      cancel: 'Оставить',
    });
    if (ok) await setShare(null, 'Ссылка выключена — по ней поход больше не открывается.');
  });
  restore.addEventListener('click', () => {
    if (removed) void setShare(removed, 'Ссылка восстановлена — старая снова работает.');
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

  // Значок «поделиться»: стрелка вверх из коробки, цвет — как у текста кнопки.
  const shareIcon = h('span', { class: 'hike-menu-icon', 'aria-hidden': 'true' });
  shareIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  const menu = h(
    'details',
    { class: 'hike-menu' },
    h('summary', { class: 'btn btn-ghost btn-small hike-menu-button' }, shareIcon, 'Поделиться'),
    h(
      'div',
      { class: 'hike-menu-panel stack' },
      h('div', { class: 'stack' }, shareSwitch, linkRow, restore, shareNote),
      h('div', { class: 'actions' }, download, remove),
      status,
    ),
  );

  // Клик мимо меню и Esc — закрыть. Слушаем, только пока меню открыто. Клики в диалогах
  // (подтверждение выключения ссылки, удаление похода) меню не закрывают.
  const onPointer = (e: PointerEvent): void => {
    const target = e.target as Element | null;
    if (target && (menu.contains(target) || target.closest('dialog'))) return;
    menu.open = false;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) menu.open = false;
  };
  menu.addEventListener('toggle', () => {
    if (menu.open) {
      document.addEventListener('pointerdown', onPointer);
      document.addEventListener('keydown', onKey);
    } else {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    }
  });
  return menu;
}
