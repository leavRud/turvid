// Маршрутизация через History API. Разбор пути — чистая функция.

export type Route =
  | { name: 'hikes' }
  | { name: 'newHike' }
  | { name: 'hike'; id: string }
  | { name: 'login' }
  | { name: 'notFound'; path: string };

/** Превращает путь адреса в маршрут. Хвостовой слэш не важен. */
export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (path) {
    case '':
    case '/':
      return { name: 'hikes' };
    case '/new':
      return { name: 'newHike' };
    case '/login':
      return { name: 'login' };
    default: {
      const hike = /^\/hikes\/([0-9a-f-]{36})$/i.exec(path);
      if (hike?.[1]) return { name: 'hike', id: hike[1].toLowerCase() };
      return { name: 'notFound', path };
    }
  }
}

/** Маршруты, доступные без входа. */
export function isPublic(route: Route): boolean {
  return route.name === 'login';
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function currentRoute(): Route {
  return matchRoute(window.location.pathname);
}

export function navigate(path: string, { replace = false } = {}): void {
  // Повторный клик по ссылке на тот же адрес (двойной клик) не перерисовывает экран.
  if (!replace && path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
}

export function onRouteChange(listener: Listener): void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
}

/** Ссылки с атрибутом data-link переходят без перезагрузки страницы. */
export function bindLinks(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-link]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href') ?? '/');
  });
}
