-- Этап 1: схема из раздела 3 ТЗ, RLS и приватный bucket для медиа.

create table public.hikes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  title         text not null,
  started_at    timestamptz,          -- null, если в треке нет времени
  finished_at   timestamptz,
  timezone      text not null,        -- IANA-зона по координатам старта
  distance_m    integer not null,
  moving_s      integer,              -- время в движении
  elev_gain_m   integer,              -- null, если высота ненадёжна
  elev_range_m  integer,
  track         jsonb not null,       -- упрощённый трек: { lon, lat, ele|null, t|null, dist }
  bbox          double precision[4] not null, -- [minLon, minLat, maxLon, maxLat]
  source_path   text,                 -- исходный файл в Storage
  share_token   text unique,          -- null = ссылка выключена
  created_at    timestamptz not null default now()
);

create table public.points (
  id          uuid primary key default gen_random_uuid(),
  hike_id     uuid not null references public.hikes on delete cascade,
  pos_m       double precision not null, -- позиция вдоль трека
  lat         double precision not null,
  lon         double precision not null,
  title       text not null default '',
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table public.media (
  id          uuid primary key default gen_random_uuid(),
  hike_id     uuid not null references public.hikes on delete cascade,
  point_id    uuid references public.points on delete set null, -- null = неразобранное
  kind        text not null check (kind in ('photo', 'video')),
  path        text not null,   -- сжатое фото или видео как есть, в Storage
  thumb_path  text not null,   -- превью 400 px (у видео — кадр)
  duration_s  real,            -- только для видео
  taken_at    timestamptz,
  lat         double precision,
  lon         double precision,
  width       integer not null,
  height      integer not null,
  sort        integer not null default 0
);

create index hikes_user_id_idx on public.hikes (user_id, started_at desc);
create index points_hike_id_idx on public.points (hike_id, pos_m);
create index media_hike_id_idx on public.media (hike_id);
create index media_point_id_idx on public.media (point_id);

-- RLS: всё читает и меняет только владелец похода.
alter table public.hikes enable row level security;
alter table public.points enable row level security;
alter table public.media enable row level security;

create policy hikes_owner on public.hikes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy points_owner on public.points
  for all to authenticated
  using (exists (
    select 1 from public.hikes h where h.id = hike_id and h.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.hikes h where h.id = hike_id and h.user_id = (select auth.uid())
  ));

create policy media_owner on public.media
  for all to authenticated
  using (exists (
    select 1 from public.hikes h where h.id = hike_id and h.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.hikes h where h.id = hike_id and h.user_id = (select auth.uid())
  ));

-- Storage: приватный bucket, путь <user_id>/<hike_id>/<uuid>.<расширение>.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy media_objects_owner on storage.objects
  for all to authenticated
  using (
    bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
