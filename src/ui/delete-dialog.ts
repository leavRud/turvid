// Удаление похода с подтверждением вводом названия (список походов и меню похода).

import { h } from './dom';
import { errorText } from './errors';

/** Показывает диалог; `remove` вызывается, только когда название введено верно. */
export function openDeleteHikeDialog(title: string, remove: () => Promise<void>): void {
  const input = h('input', { type: 'text', 'aria-label': 'Название похода', autocomplete: 'off' });
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
      h('strong', {}, title),
    ),
    input,
    h('div', { class: 'actions' }, ok, cancel),
    status,
  );
  const dialog = h('dialog', { class: 'dialog' }, form);

  input.addEventListener('input', () => {
    ok.disabled = input.value.trim() !== title.trim();
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ok.disabled = true;
    status.className = 'status';
    status.textContent = 'Удаляю…';
    try {
      await remove();
      dialog.close();
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
