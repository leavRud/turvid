// Публичная ссылка на поход: токен и загрузка похода через Edge Function share.

import type { Hike, HikeBundle, MediaItem, Point } from '../types';
import { supabase } from './client';

/** Случайный токен ссылки: 16 байт → 22 символа base64url. */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function shareUrl(token: string): string {
  return `${location.origin}/s/${token}`;
}

interface ShareResponse {
  hike: Omit<Hike, 'user_id' | 'source_path' | 'share_token'>;
  points: Point[];
  media: MediaItem[];
}

/** Поход по публичной ссылке; null — ссылка выключена или неверна (функция отдала 404). */
export async function fetchSharedHike(token: string): Promise<HikeBundle | null> {
  const { data, error, response } = await supabase.functions.invoke<ShareResponse>('share', {
    body: { token },
  });
  if (error) {
    if (response?.status === 404) return null;
    throw error;
  }
  if (!data) return null;
  return {
    // Чужих служебных полей функция не отдаёт; на экране они не нужны.
    hike: { ...data.hike, user_id: '', source_path: null, share_token: null },
    points: data.points,
    media: data.media,
  };
}
