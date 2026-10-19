// Маршрутизация через History API. Разбор пути — чистая функция.

export type Route = { name: 'hikes' } | { name: 'login' } | { name: 'notFound'; path: string };

/** Превращает путь адреса в маршрут. Хвостовой слэш не важен. */
export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (path) {
    case '':
    case '/':
      return { name: 'hikes' };
    case '/login':
      return { name: 'login' };
    default:
      return { name: 'notFound', path };
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
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
}

export function onRouteChange(listener: Listener): void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
}
