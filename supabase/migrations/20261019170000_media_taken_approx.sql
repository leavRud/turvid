-- Этап 5: время съёмки, взятое из имени файла (у фото из мессенджера нет EXIF), — примерное.
alter table public.media
  add column taken_approx boolean not null default false;
