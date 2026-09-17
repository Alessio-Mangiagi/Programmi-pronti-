import { defineConfig } from 'vitest/config'

// Test in Node del livello dati e del motore di sync (DB su better-sqlite3, nessun simulatore).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
