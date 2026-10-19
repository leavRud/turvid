import './ui/styles.css';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthChange } from './api/auth';
import { renderHikesList } from './pages/hikes-list';
import { renderLogin } from './pages/login';
import { renderNewHike } from './pages/new-hike';
import { bindLinks, currentRoute, isPublic, navigate, onRouteChange } from './router';
import { h } from './ui/dom';
import { initTheme } from './ui/theme';

initTheme();

const root = document.getElementById('app');
if (!root) throw new Error('Нет элемента #app');
const app: HTMLElement = root;

let session: Session | null = null;
/** Уборка предыдущего экрана (карта, подписки на клавиатуру). */
let cleanup: (() => void) | null = null;
/** Номер отрисовки: асинхронный экран, который опоздал, сразу убирает за собой. */
let renderId = 0;

function render(): void {
  const route = currentRoute();
  cleanup?.();
  cleanup = null;
  const id = ++renderId;
  const isCurrent = (): boolean => id === renderId;

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
      void renderHikesList(app, session?.user.email, isCurrent);
      break;
    case 'newHike':
      renderNewHike(app);
      break;
    case 'hike':
      // Экран с картой грузится отдельно: MapLibre тяжёлый, вход и список без него быстрее.
      void import('./pages/hike-view')
        .then(({ renderHikeView }) => renderHikeView(app, route.id, isCurrent))
        .then((done) => {
          if (isCurrent()) cleanup = done;
          else done();
        });
      break;
    case 'shared':
      void import('./pages/shared-view')
        .then(({ renderSharedHike }) => renderSharedHike(app, route.token, isCurrent))
        .then((done) => {
          if (isCurrent()) cleanup = done;
          else done();
        });
      break;
    case 'stats':
      void import('./pages/stats')
        .then(({ renderStats }) => renderStats(app, isCurrent))
        .then((done) => {
          if (isCurrent()) cleanup = done;
          else done();
        });
      break;
    case 'notFound':
      app.replaceChildren(
        h(
          'main',
          { class: 'page page-narrow' },
          h('h1', {}, 'Страница не найдена'),
          h('a', { href: '/', class: 'btn btn-ghost', 'data-link': true }, 'К походам'),
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
  bindLinks(app);
  onRouteChange(render);
  render();
}

void start();
