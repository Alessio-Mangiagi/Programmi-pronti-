// "><(((º> sabusabu <º)))><"
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA e API sullo stesso origin: /api → API FastAPI (in prod lo fa CloudFront)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
