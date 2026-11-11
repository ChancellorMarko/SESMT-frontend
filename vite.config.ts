import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rolldownOptions: {
        output: {
          // Bibliotecas mudam bem menos que o código da aplicação: em chunks próprios,
          // continuam em cache do navegador entre uma publicação e outra.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 30 },
              { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 20 },
              { name: 'forms', test: /node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/, priority: 20 },
            ],
          },
        },
      },
    },
    server: {
      // Generated QA captures must not reload the in-memory demonstration session.
      watch: { ignored: ['**/.local/**', '**/docs/frontend/qa/**', '**/test-results-*/**', '**/backend/**'] },
      proxy: env.VITE_API_MODE === 'api' && env.API_PROXY_TARGET
        ? { '/api/v1': { target: env.API_PROXY_TARGET, changeOrigin: true } }
        : undefined,
    },
  };
});
