import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Явный IPv4: на Windows «localhost» у Vite слушает только ::1.
  // Воркер обработки трека — ES-модуль.
  worker: { format: 'es' },
  // Экран похода с MapLibre — около 1 МБ; он грузится отдельно, только когда открыт поход.
  build: { chunkSizeWarningLimit: 1200 },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
