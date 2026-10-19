-- Cloudflare R2 из России не оплатить — фото и видео идут в любое S3-совместимое хранилище
-- (выбран Yandex Object Storage). Пометка «где лежит» теперь 's3' вместо 'r2'.

alter table public.media drop constraint media_storage_check;
update public.media set storage = 's3' where storage = 'r2';
alter table public.media
  add constraint media_storage_check check (storage in ('supabase', 's3'));

drop function if exists public.storage_usage(uuid);

-- Сколько места занято: в Supabase Storage (треки и старые фото) и в S3 (фото и видео).
create function public.storage_usage(p_hike_id uuid)
returns table (hike_bytes bigint, total_bytes bigint, s3_bytes bigint, supabase_bytes bigint)
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
  s3 as (
    select
      coalesce(sum(m.bytes) filter (where m.hike_id = p_hike_id), 0) as hike,
      coalesce(sum(m.bytes), 0) as total
    from public.media m
    where m.storage = 's3'
  )
  select sb.hike + s3.hike, sb.total + s3.total, s3.total, sb.total from sb, s3;
$$;

revoke all on function public.storage_usage(uuid) from public, anon;
grant execute on function public.storage_usage(uuid) to authenticated;
