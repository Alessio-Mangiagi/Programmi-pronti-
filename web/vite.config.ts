import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// In dev l'API gira su uvicorn :8000. Il frontend chiama sempre `/api/...`:
// qui il prefisso viene tolto; in produzione FastAPI monta l'API sotto /api.
export default defineConfig({
  plugins: [react()],
  server: {
    // packages/form-core è collegato con `file:` (symlink fuori da web/): va autorizzato in dev
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../packages'] },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
