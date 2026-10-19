import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Явный IPv4: на Windows «localhost» у Vite слушает только ::1.
  // Воркер обработки трека — ES-модуль.
  worker: { format: 'es' },
  // Тяжёлые куски грузятся отдельно и только по делу: экран похода с MapLibre (~1,2 МБ)
  // и heic2any (~1,4 МБ, только когда встретилось фото с iPhone).
  build: { chunkSizeWarningLimit: 1400 },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
