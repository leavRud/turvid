-- Этап 4: сколько места в Storage занято — для экрана похода (на бесплатном тарифе всего 1 ГБ).
-- security invoker: работают те же правила RLS на storage.objects — видны только свои файлы.

create or replace function public.storage_usage(p_hike_id uuid)
returns table (hike_bytes bigint, total_bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum((o.metadata->>'size')::bigint)
      filter (where o.name like (select auth.uid())::text || '/' || p_hike_id::text || '/%'), 0),
    coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.objects o
  where o.bucket_id = 'media'
    and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

revoke all on function public.storage_usage(uuid) from public, anon;
grant execute on function public.storage_usage(uuid) to authenticated;
