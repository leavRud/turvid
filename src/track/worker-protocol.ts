// Сообщения между страницей и воркером обработки трека.

import type { ImportErrorCode } from '../parse/types';
import type { ProcessedTrack } from './process';

export interface WorkerRequest {
  file: File;
}

export type ImportStage = 'read' | 'parse' | 'process';

export type WorkerResponse =
  | { type: 'progress'; stage: ImportStage }
  | { type: 'done'; result: ProcessedTrack }
  | { type: 'error'; code?: ImportErrorCode; message: string };
