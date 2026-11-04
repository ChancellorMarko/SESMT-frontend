import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Generated QA captures must not reload the in-memory demonstration session.
      watch: { ignored: ['**/.local/**', '**/docs/frontend/qa/**', '**/test-results-*/**', '**/backend/**'] },
      proxy: env.VITE_API_MODE === 'api' && env.API_PROXY_TARGET
        ? { '/api/v1': { target: env.API_PROXY_TARGET, changeOrigin: true } }
        : undefined,
    },
  };
});
