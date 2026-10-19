// Edge Function share: публичная ссылка на поход.
// Принимает share_token (?token=... или {"token": "..."}), проверяет его и отдаёт поход,
// точки и фото с подписанными ссылками на 1 час (фото — из Supabase Storage или S3-хранилища,
// смотря где лежат). Нет такого токена — 404.
// Вызывается без входа (verify_jwt = false): доступ даёт только сам случайный токен.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const SIGNED_URL_TTL_S = 3600;

interface S3 {
  client: AwsClient;
  base: string;
}

/** Хранилище фото (VK Cloud Object Storage по умолчанию) — те же секреты, что у функции media. */
function s3Config(): S3 | null {
  const endpoint = Deno.env.get('S3_ENDPOINT') ?? 'https://hb.ru-msk.vkcloud-storage.ru';
  const region = Deno.env.get('S3_REGION') ?? 'ru-msk';
  const accessKeyId = Deno.env.get('S3_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('S3_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('S3_BUCKET');
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region }),
    base: `${endpoint.replace(/\/+$/, '')}/${bucket}/`,
  };
}

async function presignGet(s3: S3, key: string): Promise<string> {
  const url = new URL(s3.base + key.split('/').map(encodeURIComponent).join('/'));
  url.searchParams.set('X-Amz-Expires', String(SIGNED_URL_TTL_S));
  const signed = await s3.client.sign(new Request(url, { method: 'GET' }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

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
        'id, hike_id, point_id, kind, path, thumb_path, duration_s, taken_at, taken_approx, lat, lon, width, height, sort, storage, bytes',
      )
      .eq('hike_id', hikeId)
      .order('sort'),
  ]);
  if (pointsRes.error || mediaRes.error) return json({ error: 'server error' }, 500);

  const media = mediaRes.data ?? [];
  const urls = new Map<string, string>();
  // Старые фото — в Supabase Storage, новые — в S3 (VK Cloud).
  const inSupabase = media.filter((m) => m.storage !== 's3');
  if (inSupabase.length) {
    const paths = inSupabase.flatMap((m) => [m.path, m.thumb_path]);
    const signed = await supabase.storage.from('media').createSignedUrls(paths, SIGNED_URL_TTL_S);
    if (signed.error) return json({ error: 'server error' }, 500);
    for (const s of signed.data) urls.set(s.path ?? '', s.signedUrl);
  }
  const inS3 = media.filter((m) => m.storage === 's3');
  if (inS3.length) {
    const s3 = s3Config();
    if (s3) {
      for (const m of inS3) {
        urls.set(m.path, await presignGet(s3, m.path));
        urls.set(m.thumb_path, await presignGet(s3, m.thumb_path));
      }
    }
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
