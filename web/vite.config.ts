import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // `build:web` runs this config with `--config web/vite.config.ts` from the
  // repo root, so Vite's root would otherwise default to `process.cwd()` (the
  // repo root) rather than this directory — the entry `index.html` would
  // never resolve, and `build.outDir` would land at `<repo root>/dist`
  // instead of `web/dist`, where the Worker's asset binding expects it.
  // Anchoring root to this file's own directory makes both correct
  // regardless of the caller's working directory. `.pathname` rather than
  // `fileURLToPath` mirrors the same-purpose line in the repo's
  // `vitest.config.ts`, so this file needs no Node type declarations.
  root: new URL(".", import.meta.url).pathname,
  // The SPA lives under /app so that the Worker's single-segment redirect
  // route (/:slug) can never be shadowed by an asset path.
  base: "/app/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The world atlas is ~90KB gzipped and only the map needs it.
    chunkSizeWarningLimit: 700,
  },
});
