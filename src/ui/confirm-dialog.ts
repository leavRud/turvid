// Подтверждение действия своим диалогом (в стиле сайта, а не системным confirm).

import { h } from './dom';

export interface ConfirmOptions {
  title: string;
  text: string;
  ok: string;
  cancel: string;
}

/** true — подтвердили; false — отмена, Esc или клик мимо. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const ok = h('button', { type: 'submit', class: 'btn btn-primary' }, opts.ok);
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, opts.cancel);
    const form = h(
      'form',
      { class: 'stack', method: 'dialog' },
      h('h2', {}, opts.title),
      h('p', {}, opts.text),
      h('div', { class: 'actions' }, ok, cancel),
    );
    const dialog = h('dialog', { class: 'dialog' }, form);
    // Ответ — сразу из кнопок: событие close приходит не всегда (фоновая вкладка).
    let done = false;
    const finish = (answer: boolean): void => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(answer);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(true);
    });
    cancel.addEventListener('click', () => finish(false));
    // Клик по затемнению вокруг и Esc — тоже отмена.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}
