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
  },
});
