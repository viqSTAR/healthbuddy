/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  /**
   * The panel's tests run here rather than in a separate runner config so the
   * same module resolution and env handling apply — `import.meta.env` in
   * particular, which `api/client.ts` reads at module load.
   */
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
  server: {
    port: 5173,
    // Proxy in development so the panel and the API share an origin and the
    // browser never has to deal with CORS or cross-site cookie rules.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
