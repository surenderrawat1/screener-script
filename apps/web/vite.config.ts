import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.WEB_PORT ?? '5173', 10),
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3100',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3100',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3100',
        ws: true,
      },
    },
  },
});
