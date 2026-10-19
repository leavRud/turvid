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
