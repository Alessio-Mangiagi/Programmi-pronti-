// "><(((º> sabusabu <º)))><"
/**
 * Configurazione dei test (Vitest). Separata da vite.config.ts per non caricare il
 * plugin React e Tailwind quando si testa solo logica e API.
 * I test stanno accanto al codice, in cartelle __tests__.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['comune/**/*.test.ts', 'server/**/*.test.ts', 'prisma/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    // Ogni file di test del server crea un database, carica il seed (con le password
    // cifrate scrypt) e fa più login nel beforeAll. Con 24 file in parallelo i 10 secondi
    // predefiniti a volte non bastano (fallimento intermittente visto il 24/11/2026).
    hookTimeout: 30_000,
    // 26/11/2026: i test con molti login (scrypt) durano meno di un secondo da soli, ma con
    // 40 file in parallelo e il PC occupato hanno superato più volte i 5 secondi predefiniti.
    testTimeout: 30_000,
  },
});
