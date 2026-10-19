import { sendLoginLink } from '../api/auth';
import { h } from '../ui/dom';
import { errorText } from '../ui/errors';

/** Экран входа: почта и кнопка «Прислать ссылку». */
export function renderLogin(root: HTMLElement): void {
  const input = h('input', {
    type: 'email',
    name: 'email',
    required: true,
    autocomplete: 'email',
    inputmode: 'email',
    placeholder: 'you@example.com',
    'aria-label': 'Почта',
  });
  const button = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Прислать ссылку');
  const status = h('p', { class: 'status', role: 'status' });
  const form = h('form', { class: 'login-form' }, input, button, status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    button.disabled = true;
    status.className = 'status';
    status.textContent = 'Отправляю…';
    try {
      await sendLoginLink(email);
      status.textContent = `Ссылка отправлена на ${email}. Открой письмо и нажми на неё.`;
    } catch (err) {
      status.className = 'status status-error';
      status.textContent = `Не получилось отправить ссылку: ${errorText(err)}`;
    } finally {
      button.disabled = false;
    }
  });

  root.replaceChildren(
    h(
      'main',
      { class: 'page page-narrow' },
      h('h1', { class: 'logo' }, 'Turvid'),
      h('p', { class: 'muted' }, 'Дневник походов. Вход по ссылке из письма, без пароля.'),
      form,
    ),
  );
  input.focus();
}
