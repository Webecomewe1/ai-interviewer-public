import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'public',
    define: {
      __API_BASE__: JSON.stringify(env.VITE_API_URL || ''),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
        '/live': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'public/index.html'),
          interview: resolve(__dirname, 'public/interview.html'),
          results: resolve(__dirname, 'public/results.html'),
          login: resolve(__dirname, 'public/login.html'),
          register: resolve(__dirname, 'public/register.html'),
        },
      },
    },
  };
});
