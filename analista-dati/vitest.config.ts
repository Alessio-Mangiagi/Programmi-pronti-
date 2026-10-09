import { defineConfig } from 'vitest/config'

// "><(((º> sabusabu <º)))><"
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./server/test-setup.ts'],
  },
})
