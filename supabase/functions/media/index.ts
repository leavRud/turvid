// Edge Function media: фото и видео в S3-совместимом хранилище (Yandex Object Storage).
// Ключи хранилища живут только здесь (секреты Supabase), браузер получает одноразовые ссылки.
// Только для вошедшего владельца (verify_jwt = true). Действия (POST JSON):
//   { action: 'status' }                                  → { s3: true|false }
//   { action: 'upload', hikeId, files: [{ name }] }       → { urls: [{ key, url }] }  (PUT, 1 час)
//   { action: 'sign', keys: [...] }                       → { urls: { key: url } }    (GET, 1 час)
//   { action: 'delete', keys: [...] }                     → { deleted: n }
// Ключи всегда начинаются с <user_id>/ — чужое не подписать и не удалить.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const URL_TTL_S = 3600;
const UUID_RE = /^[0-9a-f-]{36}$/i;
/** Имя файла внутри похода: uuid[.thumb].ext — как пишет клиент. */
const NAME_RE = /^[0-9a-f-]{36}(\.thumb)?\.[a-z0-9]{1,8}$/i;
const MAX_KEYS = 200;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

interface S3 {
  client: AwsClient;
  base: string;
}

/**
 * Хранилище из секретов Supabase. Адрес и регион по умолчанию — Yandex Object Storage;
 * для другого S3 (Selectel, VK Cloud, Backblaze) задать S3_ENDPOINT и S3_REGION.
 */
function s3Config(): S3 | null {
  const endpoint = Deno.env.get('S3_ENDPOINT') ?? 'https://storage.yandexcloud.net';
  const region = Deno.env.get('S3_REGION') ?? 'ru-central1';
  const accessKeyId = Deno.env.get('S3_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('S3_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('S3_BUCKET');
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region }),
    base: `${endpoint.replace(/\/+$/, '')}/${bucket}/`,
  };
}

const objectUrl = (s3: S3, key: string): string =>
  s3.base + key.split('/').map(encodeURIComponent).join('/');

async function presign(s3: S3, key: string, method: 'GET' | 'PUT'): Promise<string> {
  const url = new URL(objectUrl(s3, key));
  url.searchParams.set('X-Amz-Expires', String(URL_TTL_S));
  const signed = await s3.client.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // Кто спрашивает: клиент Supabase с токеном пользователя — работают его RLS.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) return json({ error: 'auth' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const s3 = s3Config();
  if (body['action'] === 'status') return json({ s3: s3 !== null });
  if (!s3) return json({ error: 's3-not-configured' }, 503);

  const ownKeys = (raw: unknown): string[] | null => {
    if (!Array.isArray(raw) || raw.length > MAX_KEYS) return null;
    const keys = raw.filter((k): k is string => typeof k === 'string');
    if (keys.length !== raw.length) return null;
    return keys.every((k) => k.startsWith(`${userId}/`) && !k.includes('..')) ? keys : null;
  };

  switch (body['action']) {
    case 'upload': {
      const hikeId = body['hikeId'];
      const files = body['files'];
      if (typeof hikeId !== 'string' || !UUID_RE.test(hikeId) || !Array.isArray(files)) {
        return json({ error: 'bad request' }, 400);
      }
      if (files.length > MAX_KEYS) return json({ error: 'too many' }, 400);
      // Поход должен быть свой: под RLS чужой просто не найдётся.
      const { data: hike } = await supabase
        .from('hikes')
        .select('id')
        .eq('id', hikeId)
        .maybeSingle();
      if (!hike) return json({ error: 'not found' }, 404);
      const urls: { key: string; url: string }[] = [];
      for (const f of files) {
        const name = (f as { name?: unknown })?.name;
        if (typeof name !== 'string' || !NAME_RE.test(name))
          return json({ error: 'bad name' }, 400);
        const key = `${userId}/${hikeId}/${name}`;
        urls.push({ key, url: await presign(s3, key, 'PUT') });
      }
      return json({ urls });
    }
    case 'sign': {
      const keys = ownKeys(body['keys']);
      if (!keys) return json({ error: 'bad keys' }, 400);
      const urls: Record<string, string> = {};
      for (const key of keys) urls[key] = await presign(s3, key, 'GET');
      return json({ urls });
    }
    case 'delete': {
      const keys = ownKeys(body['keys']);
      if (!keys) return json({ error: 'bad keys' }, 400);
      let deleted = 0;
      for (const key of keys) {
        const res = await s3.client.fetch(objectUrl(s3, key), { method: 'DELETE' });
        if (res.ok || res.status === 404) deleted++;
      }
      return json({ deleted });
    }
    default:
      return json({ error: 'unknown action' }, 400);
  }
});
