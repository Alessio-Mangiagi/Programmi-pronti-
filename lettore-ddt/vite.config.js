import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// "><(((º> sabusabu <º)))><"

export default defineConfig({
  plugins: [react()],
  root: 'static',
  build: {
    outDir: '../dist/static',
    emptyOutDir: true,
    rollupOptions: {
      external: ['xlsx'],
      output: {
        globals: { xlsx: 'XLSX' },
      },
    },
  },
  define: {
    // XLSX è caricato come UMD globale via script tag in index.html
    'window.XLSX': 'window.XLSX',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
    },
  },
});