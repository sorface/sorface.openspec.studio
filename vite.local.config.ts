import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  build: {
    emptyOutDir: true,
    outDir: "../backend/internal/web/dist",
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
