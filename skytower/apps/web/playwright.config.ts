// "><(((º> sabusabu <º)))><"
// Test end-to-end nel browser contro un ambiente usa-e-getta: `cde dev --reset` su una cartella dati propria
// (mai .devdata dell'istanza di sviluppo) con porte dedicate, e la build della SPA servita da `vite preview`.
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = process.env.PYTHON
  ?? [resolve(ROOT, ".venv/Scripts/python.exe"), resolve(ROOT, ".venv/bin/python")].find(existsSync)
  ?? "python";
const API_PORT = 8310;
const WEB_PORT = 4310;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 1000 } } }],
  webServer: [
    {
      command: `"${PYTHON}" -m cde_api.cli dev --reset --data-dir "${join(tmpdir(), "cde-e2e")}" --port ${API_PORT} --s3-port ${API_PORT + 1000}`,
      cwd: resolve(ROOT, "apps/api"),
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "ignore",
    },
    {
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      env: { CDE_API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
