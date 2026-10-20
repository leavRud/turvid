// Фото, выбранные сразу после сохранения похода: экран похода подхватит их и запустит загрузку.
// Выбор файла открывается только по нажатию, поэтому файлы выбирают ещё на экране «Новый поход».

let pending: { hikeId: string; files: File[] } | null = null;

export function handOffUpload(hikeId: string, files: File[]): void {
  pending = { hikeId, files };
}

/** Забрать файлы для этого похода (один раз). */
export function takeUpload(hikeId: string): File[] {
  if (pending?.hikeId !== hikeId) return [];
  const { files } = pending;
  pending = null;
  return files;
}
