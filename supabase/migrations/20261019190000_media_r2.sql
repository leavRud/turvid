-- Фото и видео переезжают в Cloudflare R2 (10 ГБ бесплатно, трафик бесплатный).
-- Старые файлы остаются в Supabase Storage: у каждого медиа помечено, где оно лежит.

alter table public.media
  add column storage text not null default 'supabase' check (storage in ('supabase', 'r2')),
  -- Размер файла и превью, байты: место в R2 считаем по базе (R2 не видно из Postgres).
  add column bytes bigint not null default 0;

-- Сколько места занято: в Supabase Storage (исходные треки и старые фото) и в R2.
drop function if exists public.storage_usage(uuid);

create function public.storage_usage(p_hike_id uuid)
returns table (hike_bytes bigint, total_bytes bigint, r2_bytes bigint, supabase_bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with sb as (
    select
      coalesce(sum((o.metadata->>'size')::bigint)
        filter (where o.name like (select auth.uid())::text || '/' || p_hike_id::text || '/%'), 0) as hike,
      coalesce(sum((o.metadata->>'size')::bigint), 0) as total
    from storage.objects o
    where o.bucket_id = 'media'
      and (storage.foldername(o.name))[1] = (select auth.uid())::text
  ),
  r2 as (
    select
      coalesce(sum(m.bytes) filter (where m.hike_id = p_hike_id), 0) as hike,
      coalesce(sum(m.bytes), 0) as total
    from public.media m
    where m.storage = 'r2'
  )
  select sb.hike + r2.hike, sb.total + r2.total, r2.total, sb.total from sb, r2;
$$;

revoke all on function public.storage_usage(uuid) from public, anon;
grant execute on function public.storage_usage(uuid) to authenticated;
