import { defineConfig } from "vite";

// Built into dist/web and served by `lingxi ui` (src/ui/server.ts). No React plugin needed: esbuild handles JSX.
export default defineConfig({
  root: __dirname,
  base: "./",
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
});
