// Очередь загрузки: не больше N задач сразу, повтор при обрыве связи. Без DOM и сети.

export interface QueueOptions {
  concurrency: number;
  /** Сколько раз пробовать каждую задачу. */
  attempts: number;
  /** Пауза перед повтором номер `attempt` (с 1), мс. */
  backoffMs: (attempt: number) => number;
  /** Повторять ли после этой ошибки (обрыв — да, «формат не тот» — нет). */
  retryable: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** После каждой законченной задачи (успех или окончательная ошибка). */
  onSettled?: (index: number, done: number, total: number) => void;
}

export type QueueResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Выполняет задачи с ограничением параллельности; результат — в порядке входа. */
export async function runQueue<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
  opts: QueueOptions,
): Promise<QueueResult<R>[]> {
  const sleep = opts.sleep ?? defaultSleep;
  const results: QueueResult<R>[] = new Array(items.length);
  let next = 0;
  let done = 0;

  async function runOne(index: number): Promise<void> {
    const item = items[index] as T;
    for (let attempt = 1; ; attempt++) {
      try {
        results[index] = { ok: true, value: await task(item, index) };
        return;
      } catch (err) {
        if (attempt >= opts.attempts || !opts.retryable(err)) {
          results[index] = { ok: false, error: err };
          return;
        }
        await sleep(opts.backoffMs(attempt));
      }
    }
  }

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      await runOne(index);
      done++;
      opts.onSettled?.(index, done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(opts.concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Похоже ли на сетевую ошибку, которую стоит повторить. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch: «Failed to fetch»
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String(err.message)
        : String(err);
  return /network|fetch|timeout|timed out|ECONN|50[234]|429/i.test(msg);
}
