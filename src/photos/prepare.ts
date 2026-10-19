// Подготовка выбранного файла к загрузке: проверка, HEIC → JPEG, EXIF, сжатие или кадр видео.

import type { PreparedMedia } from '../api/media';
import { compressImage } from './compress';
import { readPhotoMeta } from './exif';
import { classifyFile } from './files';
import { readVideo } from './video';

export interface Prepared {
  media: PreparedMedia;
  /** Предупреждение для человека, загрузку не останавливает. */
  warning: string | null;
}

/** Ошибка, которую показываем человеку как есть. */
export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

/** Может ли этот браузер проиграть HEVC (видео с iPhone). */
function canPlayHevc(): boolean {
  const v = document.createElement('video');
  return (
    v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '' ||
    v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== ''
  );
}

export async function prepareFile(file: File, hikeTimeZone: string): Promise<Prepared> {
  const kind = classifyFile(file);
  if (kind.error) throw new MediaError(kind.error);

  if (kind.kind === 'video') {
    const info = await readVideo(file);
    let warning: string | null = null;
    if (!info.readable) {
      warning =
        'Браузер не смог прочитать это видео — превью будет заглушкой, а проиграть его здесь может не получиться.';
    } else if (kind.ext === 'mov' && !canPlayHevc()) {
      warning = 'Видео с iPhone (HEVC) на этом устройстве может не проигрываться.';
    }
    return {
      media: {
        kind: 'video',
        file,
        ext: kind.ext,
        thumb: info.thumb,
        width: info.width,
        height: info.height,
        durationS: info.durationS,
        takenAt: null,
        lat: null,
        lon: null,
      },
      warning,
    };
  }

  // EXIF — из исходника, до сжатия.
  const meta = await readPhotoMeta(file, hikeTimeZone);
  let source: Blob = file;
  if (kind.heic) {
    // heic2any тяжёлый (~1,3 МБ), грузим только когда встретили HEIC.
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    source = Array.isArray(converted) ? (converted[0] as Blob) : converted;
  }
  const c = await compressImage(source);
  return {
    media: {
      kind: 'photo',
      file: c.full,
      ext: c.full.type === 'image/webp' ? 'webp' : 'jpg',
      thumb: c.thumb,
      width: c.width,
      height: c.height,
      durationS: null,
      takenAt: meta.takenAt,
      lat: meta.lat,
      lon: meta.lon,
    },
    warning: null,
  };
}
