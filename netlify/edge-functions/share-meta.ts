// Netlify Edge Function для /s/<token>: мессенджеры не выполняют JavaScript, поэтому название
// похода в <title> и og:title подставляем на сервере. Выключенная или неверная ссылка — 404.
// Данные — из Supabase Edge Function share (режим meta: только название, даты и км).

import type { Config, Context } from 'https://edge.netlify.com';

const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

interface MetaHike {
  title: string;
  started_at: string | null;
  finished_at: string | null;
  timezone: string;
  distance_m: number;
}

declare const Netlify: { env: { get(name: string): string | undefined } };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function describe(h: MetaHike): string {
  const km = `${(h.distance_m / 1000).toFixed(1).replace('.', ',')} км`;
  if (!h.started_at) return `Поход · ${km}`;
  const date = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: h.timezone,
  }).format(new Date(h.started_at));
  return `Поход ${date} · ${km}`;
}

function withHead(html: string, title: string, description: string): string {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta name="robots" content="noindex" />',
  ].join('\n    ');
  return html.replace(/<title>[\s\S]*?<\/title>/, tags);
}

export default async function shareMeta(request: Request, context: Context): Promise<Response> {
  const page = await context.next();
  const html = await page.text();
  const headers = new Headers(page.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');

  const token = new URL(request.url).pathname.split('/')[2] ?? '';
  const notFound = (): Response =>
    new Response(withHead(html, 'Ссылка не работает — Turvid', 'Ссылка выключена или неверна.'), {
      status: 404,
      headers,
    });
  if (!TOKEN_RE.test(token)) return notFound();

  const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL');
  if (!supabaseUrl) return new Response(html, { status: page.status, headers });
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/share?token=${token}&meta=1`);
    if (res.status === 404) return notFound();
    if (!res.ok) return new Response(html, { status: page.status, headers });
    const { hike } = (await res.json()) as { hike: MetaHike };
    return new Response(withHead(html, `${hike.title} — Turvid`, describe(hike)), {
      status: 200,
      headers,
    });
  } catch {
    // Supabase недоступен — отдаём страницу как есть, она сама всё загрузит.
    return new Response(html, { status: page.status, headers });
  }
}

export const config: Config = { path: '/s/*' };
