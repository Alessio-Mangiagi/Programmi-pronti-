// "><(((º> sabusabu <º)))><"
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA e API sullo stesso origin: /api → API FastAPI (in prod lo fa CloudFront)
// Porta 5195 riservata a SkyTower nella suite (la 5173 è di Analista Dati).
// `vite preview` (avvio dalla suite, build in dist/) eredita lo stesso proxy.
// CDE_API_URL punta a un'altra API (es. un'istanza di prova accanto a quella in uso).
const api = {
  "/api": {
    target: process.env.CDE_API_URL ?? "http://127.0.0.1:8100",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5195, strictPort: true, proxy: api },
  // CDE_PREVIEW_CSP: i test e2e servono la build con la Content-Security-Policy di produzione
  preview: { port: 5195, strictPort: true, proxy: api,
             headers: process.env.CDE_PREVIEW_CSP ? { "Content-Security-Policy": process.env.CDE_PREVIEW_CSP } : {} },
  build: {
    rollupOptions: {
      output: {
        // librerie in chunk separati: cambiano di rado, quindi restano in cache tra un rilascio e l'altro
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          mui: ["@mui/material", "@emotion/react", "@emotion/styled"],
          "mui-tree": ["@mui/x-tree-view"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
