// "><(((º> sabusabu <º)))><"
/**
 * Frontend di Copilota (React + Tailwind) servito da Vite sulla porta 5210.
 *
 * In sviluppo le chiamate /api vanno al backend Express (porta 3012, server/index.ts):
 * il browser parla con una sola origine, quindi niente CORS e, dal Giorno 2, il cookie
 * di sessione resta sullo stesso indirizzo della pagina.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const portaApi = process.env.LOGBOOK_API_PORT ?? '3012';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5210,
    // Porta fissa: se è occupata meglio un errore chiaro che un'app su una porta diversa.
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': `http://127.0.0.1:${portaApi}`,
    },
  },
});
