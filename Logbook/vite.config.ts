// "><(((º> sabusabu <º)))><"
/**
 * Frontend di Copilota (React + Tailwind) servito da Vite sulla porta 5210.
 *
 * In sviluppo le chiamate /api vanno al backend Express (porta 3012, server/index.ts):
 * il browser parla con una sola origine, quindi niente CORS e, dal Giorno 2, il cookie
 * di sessione resta sullo stesso indirizzo della pagina.
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { normalizzaPercorso } from './comune/percorso';

const portaApi = process.env.LOGBOOK_API_PORT ?? '3012';

// LOGBOOK_PERCORSO (es. /copilota) arriva dall'ambiente oppure dal .env, che Vite di suo non
// mette in process.env: lo stesso valore lo usa server/app.ts per togliere il prefisso.
// Con `base` Vite scrive nella pagina compilata gli indirizzi giusti di script, stili e
// immagini ("/copilota/assets/…"). Il server ricompila a ogni avvio (npm run prestart),
// quindi cambiare il valore nel .env e riavviare basta.
const percorso = normalizzaPercorso(process.env.LOGBOOK_PERCORSO ?? loadEnv('production', process.cwd(), 'LOGBOOK_').LOGBOOK_PERCORSO);

export default defineConfig({
  base: `${percorso}/`,
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
