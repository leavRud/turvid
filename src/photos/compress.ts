// Сжатие фото в браузере: длинная сторона 2048 px, WebP 0,82, плюс превью 400 px. EXIF не копируется.

export const FULL_SIZE_PX = 2048;
export const THUMB_SIZE_PX = 400;
export const FULL_QUALITY = 0.82;
export const THUMB_QUALITY = 0.8;

/** Размер с длинной стороной не больше `max` (меньшие картинки не увеличиваются). */
export function fitSize(width: number, height: number, max: number): [number, number] {
  const k = Math.min(1, max / Math.max(width, height));
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

/** Рисует картинку в нужном размере и кодирует в WebP (если браузер не умеет — в JPEG). */
export async function encode(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  max: number,
  quality: number,
): Promise<Blob> {
  const [w, h] = fitSize(srcWidth, srcHeight, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не дал canvas для сжатия');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  const toBlob = (type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob('image/webp');
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob('image/jpeg');
  if (!jpeg) throw new Error('Не удалось сжать фото');
  return jpeg;
}

export interface Compressed {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

/** Сжимает фото с учётом ориентации из EXIF (браузер поворачивает сам). */
export async function compressImage(blob: Blob): Promise<Compressed> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const [width, height] = fitSize(bitmap.width, bitmap.height, FULL_SIZE_PX);
    const full = await encode(bitmap, bitmap.width, bitmap.height, FULL_SIZE_PX, FULL_QUALITY);
    const thumb = await encode(bitmap, bitmap.width, bitmap.height, THUMB_SIZE_PX, THUMB_QUALITY);
    return { full, thumb, width, height };
  } finally {
    bitmap.close();
  }
}
