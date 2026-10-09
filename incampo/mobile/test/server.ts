/**
 * Backend reale per i test di integrazione: scripts/e2e_server.py (SQLite
 * usa-e-getta + seed demo) lanciato come processo figlio, API sotto /api.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApi, type Api } from '../src/api/client'

const ROOT = resolve(__dirname, '../..')
const PYTHON =
  process.env.PYTHON ?? [resolve(ROOT, '.venv/Scripts/python.exe'), resolve(ROOT, '.venv/bin/python')].find(existsSync) ?? 'python'

export type TestServer = { baseUrl: string; stop: () => void; login: (email: string) => Promise<Api> }

export async function startServer(port = 8002): Promise<TestServer> {
  const proc: ChildProcess = spawn(PYTHON, ['-m', 'scripts.e2e_server', '--port', String(port), '--dir', resolve(__dirname, '../.e2e')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  proc.stderr?.on('data', (d) => (stderr += d.toString()))
  const baseUrl = `http://127.0.0.1:${port}/api`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`e2e_server terminato: ${stderr}`)
    try {
      const r = await fetch(`${baseUrl}/docs`)
      if (r.ok) break
    } catch {
      /* non ancora su */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const stop = () => {
    proc.kill()
  }
  const login = async (email: string): Promise<Api> => {
    const r = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'demo1234' }),
    })
    if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
    const { access_token } = (await r.json()) as { access_token: string }
    return createApi({ baseUrl, getToken: () => access_token })
  }
  return { baseUrl, stop, login }
}
