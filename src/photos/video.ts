// Видео: длительность, размер и кадр-превью на первой секунде — через <video> и canvas.

import { encode, THUMB_QUALITY, THUMB_SIZE_PX } from './compress';

export interface VideoInfo {
  durationS: number | null;
  width: number;
  height: number;
  thumb: Blob;
}

/** Размер кадра, если браузер не смог прочитать видео. */
const FALLBACK_W = 1920;
const FALLBACK_H = 1080;

function once(el: HTMLElement, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    el.addEventListener(
      ok,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('error'));
      },
      { once: true },
    );
  });
}

/** Заглушка-превью для видео, которое браузер не может показать. */
async function placeholderThumb(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE_PX;
  canvas.height = Math.round((THUMB_SIZE_PX * 9) / 16);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--color-video-placeholder').trim() || 'gray';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = css.getPropertyValue('--color-viewer-text').trim() || 'white';
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 24, canvas.height / 2 - 30);
    ctx.lineTo(canvas.width / 2 + 30, canvas.height / 2);
    ctx.lineTo(canvas.width / 2 - 24, canvas.height / 2 + 30);
    ctx.fill();
  }
  return encode(canvas, canvas.width, canvas.height, THUMB_SIZE_PX, THUMB_QUALITY);
}

/** Длительность и превью. Если браузер видео не читает — превью-заглушка, ошибки нет. */
export async function readVideo(file: Blob): Promise<VideoInfo & { readable: boolean }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await once(video, 'loadedmetadata', 15_000);
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    video.currentTime = Math.min(1, (duration ?? 2) / 2);
    await once(video, 'seeked', 15_000);
    const thumb = await encode(
      video,
      video.videoWidth,
      video.videoHeight,
      THUMB_SIZE_PX,
      THUMB_QUALITY,
    );
    return {
      durationS: duration,
      width: video.videoWidth || FALLBACK_W,
      height: video.videoHeight || FALLBACK_H,
      thumb,
      readable: true,
    };
  } catch {
    return {
      durationS: null,
      width: FALLBACK_W,
      height: FALLBACK_H,
      thumb: await placeholderThumb(),
      readable: false,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}
