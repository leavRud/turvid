// Название похода в шапке: у владельца рядом кнопка ✎ — правка прямо на месте.

import { renameHike } from '../api/hikes';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';

export const HIKE_TITLE_MAX = 120;

export interface HikeTitle {
  element: HTMLElement;
  title(): string;
}

export function createHikeTitle(
  hikeId: string,
  initial: string,
  editable: boolean,
  onRename: (title: string) => void,
): HikeTitle {
  let title = initial;
  const element = h('div', { class: 'hike-title' });

  function showView(): void {
    const heading = h('h1', {}, title);
    if (!editable) {
      element.replaceChildren(heading);
      return;
    }
    const edit = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': 'Изменить название',
        title: 'Изменить название',
      },
      '✎',
    );
    edit.addEventListener('click', showEdit);
    element.replaceChildren(heading, edit);
  }

  function showEdit(): void {
    const input = h('input', {
      type: 'text',
      value: title,
      maxlength: String(HIKE_TITLE_MAX),
      required: true,
      'aria-label': 'Название похода',
    });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Сохранить');
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Отмена');
    const status = h('p', { class: 'status status-error', role: 'status' });
    const form = h(
      'form',
      { class: 'hike-title-form' },
      input,
      h('div', { class: 'actions' }, save, cancel),
      status,
    );
    cancel.addEventListener('click', showView);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') showView();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = input.value.trim();
      if (!next || next === title) {
        showView();
        return;
      }
      save.disabled = true;
      try {
        await renameHike(hikeId, next);
        title = next;
        onRename(next);
        showView();
      } catch (err) {
        save.disabled = false;
        status.textContent = `Не получилось переименовать: ${errorText(err)}`;
      }
    });
    element.replaceChildren(form);
    input.focus();
    input.select();
  }

  showView();
  return { element, title: () => title };
}
