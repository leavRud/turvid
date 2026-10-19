import './ui/styles.css';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthChange } from './api/auth';
import { renderHikesList } from './pages/hikes-list';
import { renderLogin } from './pages/login';
import { currentRoute, isPublic, navigate, onRouteChange } from './router';
import { h } from './ui/dom';

const root = document.getElementById('app');
if (!root) throw new Error('Нет элемента #app');
const app: HTMLElement = root;

let session: Session | null = null;

function render(): void {
  const route = currentRoute();

  if (!session && !isPublic(route)) {
    navigate('/login', { replace: true });
    return;
  }
  if (session && route.name === 'login') {
    navigate('/', { replace: true });
    return;
  }

  switch (route.name) {
    case 'login':
      renderLogin(app);
      break;
    case 'hikes':
      void renderHikesList(app, session?.user.email);
      break;
    case 'notFound':
      app.replaceChildren(
        h(
          'main',
          { class: 'page page-narrow' },
          h('h1', {}, 'Страница не найдена'),
          h('a', { href: '/', class: 'btn btn-ghost' }, 'К походам'),
        ),
      );
      break;
  }
}

async function start(): Promise<void> {
  // getSession дожидается разбора токена из ссылки в письме.
  session = await getSession();
  onAuthChange((next) => {
    const changed = (next?.user.id ?? null) !== (session?.user.id ?? null);
    session = next;
    if (changed) render();
  });
  onRouteChange(render);
  render();
}

void start();
