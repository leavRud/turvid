// Запуск обработки файла в воркере со стороны страницы.

// Только типы и константы: сам разбор живёт в воркере и не попадает в основной бандл.
import { ImportError, MAX_FILE_BYTES } from '../parse/types';
import type { ProcessedTrack } from './process';
import type { ImportStage, WorkerRequest, WorkerResponse } from './worker-protocol';

export type { ImportStage } from './worker-protocol';

/** Обрабатывает файл трека в отдельном потоке. Ошибки для человека — ImportError. */
export function importTrackFile(
  file: File,
  onProgress: (stage: ImportStage) => void,
): Promise<ProcessedTrack> {
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new ImportError('too-large'));

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const finish = (): void => worker.terminate();

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress(msg.stage);
      } else if (msg.type === 'done') {
        finish();
        resolve(msg.result);
      } else {
        finish();
        reject(msg.code ? new ImportError(msg.code) : new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'Не удалось обработать файл'));
    };

    const request: WorkerRequest = { file };
    worker.postMessage(request);
  });
}
