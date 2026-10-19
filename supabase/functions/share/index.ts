// Edge Function share: публичная ссылка на поход.
// Принимает share_token (?token=... или {"token": "..."}), проверяет его и отдаёт поход,
// точки и фото с подписанными ссылками на 1 час. Нет такого токена — 404.
// Вызывается без входа (verify_jwt = false): доступ даёт только сам случайный токен.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SIGNED_URL_TTL_S = 3600;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function readToken(req: Request): Promise<{ token: string | null; meta: boolean }> {
  const url = new URL(req.url);
  let token = url.searchParams.get('token');
  let meta = url.searchParams.get('meta') === '1';
  if (!token && req.method === 'POST') {
    try {
      const body = (await req.json()) as { token?: unknown; meta?: unknown };
      if (typeof body.token === 'string') token = body.token;
      if (body.meta === true) meta = true;
    } catch {
      // пустое тело
    }
  }
  return { token, meta };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const { token, meta } = await readToken(req);
  if (!token || !TOKEN_RE.test(token)) return json({ error: 'not found' }, 404);

  // Сервисный ключ — только здесь, на сервере; RLS обходим осознанно: проверка — по токену.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const columns = meta
    ? 'id, title, started_at, finished_at, timezone, distance_m'
    : 'id, title, started_at, finished_at, timezone, distance_m, moving_s, elev_gain_m, elev_range_m, track, bbox, created_at';
  const { data: hike, error } = await supabase
    .from('hikes')
    .select(columns)
    .eq('share_token', token)
    .maybeSingle();
  if (error) return json({ error: 'server error' }, 500);
  if (!hike) return json({ error: 'not found' }, 404);
  // Только название и даты — для превью ссылки в мессенджерах.
  if (meta) return json({ hike });

  const hikeId = (hike as { id: string }).id;
  const [pointsRes, mediaRes] = await Promise.all([
    supabase
      .from('points')
      .select('id, hike_id, pos_m, lat, lon, title, description, created_at')
      .eq('hike_id', hikeId)
      .order('pos_m'),
    supabase
      .from('media')
      .select(
        'id, hike_id, point_id, kind, path, thumb_path, duration_s, taken_at, taken_approx, lat, lon, width, height, sort',
      )
      .eq('hike_id', hikeId)
      .order('sort'),
  ]);
  if (pointsRes.error || mediaRes.error) return json({ error: 'server error' }, 500);

  const media = mediaRes.data ?? [];
  let urls = new Map<string, string>();
  if (media.length) {
    const paths = media.flatMap((m) => [m.path, m.thumb_path]);
    const signed = await supabase.storage.from('media').createSignedUrls(paths, SIGNED_URL_TTL_S);
    if (signed.error) return json({ error: 'server error' }, 500);
    urls = new Map(signed.data.map((s) => [s.path ?? '', s.signedUrl]));
  }

  return json({
    hike,
    points: pointsRes.data ?? [],
    media: media.map((m) => ({
      ...m,
      url: urls.get(m.path) ?? '',
      thumbUrl: urls.get(m.thumb_path) ?? '',
    })),
  });
});
