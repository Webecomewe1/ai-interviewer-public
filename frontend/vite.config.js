import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/live': {
        target: 'http://localhost:3000',
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
});