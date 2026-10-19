// Общие типы приложения.

/** Упрощённый трек в колоночном виде, как он лежит в `hikes.track`. */
export interface TrackData {
  lon: number[];
  lat: number[];
  ele: number[] | null;
  /** Секунды от `started_at`. */
  t: number[] | null;
  /** Накопленное расстояние от старта, м. */
  dist: number[];
}

/** Строка таблицы `hikes`. */
export interface Hike {
  id: string;
  user_id: string;
  title: string;
  started_at: string | null;
  finished_at: string | null;
  timezone: string;
  distance_m: number;
  moving_s: number | null;
  elev_gain_m: number | null;
  elev_range_m: number | null;
  track: TrackData;
  bbox: [number, number, number, number];
  source_path: string | null;
  share_token: string | null;
  created_at: string;
}

/** Поход для списка: без служебных полей, но с треком для мини-карты и числом фото. */
export type HikeListItem = Omit<Hike, 'source_path' | 'share_token'> & { photos: number };

/** Строка таблицы `points`: место на треке с названием и описанием. */
export interface Point {
  id: string;
  hike_id: string;
  pos_m: number;
  lat: number;
  lon: number;
  title: string;
  description: string;
  created_at: string;
}

/** Строка таблицы `media`: фото или видео похода. */
export interface Media {
  id: string;
  hike_id: string;
  /** null — неразобранное. */
  point_id: string | null;
  kind: 'photo' | 'video';
  /** Где лежат файлы: S3 — Yandex Object Storage (новые) или Supabase Storage (старые). */
  storage: 'supabase' | 's3';
  /** Размер файла и превью, байты. */
  bytes: number;
  path: string;
  thumb_path: string;
  duration_s: number | null;
  taken_at: string | null;
  /** Время взято из имени файла — примерное. */
  taken_approx: boolean;
  lat: number | null;
  lon: number | null;
  width: number;
  height: number;
  sort: number;
}

/** Медиа с подписанными ссылками (живут час). */
export interface MediaItem extends Media {
  url: string;
  thumbUrl: string;
}

/** Всё, что нужно экрану просмотра похода. */
export interface HikeBundle {
  hike: Hike;
  points: Point[];
  media: MediaItem[];
}
