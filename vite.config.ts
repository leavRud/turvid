import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Явный IPv4: на Windows «localhost» у Vite слушает только ::1.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
