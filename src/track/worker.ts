// Web Worker: разбор и обработка файла трека, чтобы интерфейс не замирал.

import { ImportError, parseTrackFile } from '../parse';
import { processTrack } from './process';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

// В tsconfig подключены и DOM, и WebWorker, поэтому `self` типизирован как Window.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function send(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { file } = e.data;
  try {
    send({ type: 'progress', stage: 'read' });
    const data = await file.arrayBuffer();
    send({ type: 'progress', stage: 'parse' });
    const parsed = await parseTrackFile(file.name, data);
    send({ type: 'progress', stage: 'process' });
    send({ type: 'done', result: processTrack(parsed) });
  } catch (err) {
    if (err instanceof ImportError) send({ type: 'error', code: err.code, message: err.message });
    else send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
