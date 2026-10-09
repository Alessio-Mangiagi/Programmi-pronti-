import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Smoke test contro la build di produzione: `npm run build`, poi scripts/e2e_server.py
// serve API (/api) e dist sulla stessa porta con un DB SQLite usa-e-getta + seed demo.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON =
  process.env.PYTHON ??
  [resolve(ROOT, '.venv/Scripts/python.exe'), resolve(ROOT, '.venv/bin/python')].find(existsSync) ??
  'python'
const PORT = 8001

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm --prefix web run build && "${PYTHON}" -m scripts.e2e_server --port ${PORT}`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/api/docs`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
