/** Текст ошибки для человека: Error, ошибка Supabase ({ message }) или что угодно. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err && 'message' in err) return String(err.message);
  return String(err);
}
