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
  // Deliberately NOT "/app/". `base` only controls the URLs Vite bakes into
  // the built HTML/JS/CSS for its own asset references — it says nothing
  // about where the *document* is served, which the Worker's explicit
  // `/app` and `/app/*` routes already handle. Cloudflare's static-asset
  // router serves `web/dist/**` at the site root with no extra prefix
  // (`web/dist/assets/x.js` → `/assets/x.js`), which is exactly why `assets`
  // is already a reserved slug (`src/lib/slug.ts`) — a short link can never
  // collide with it. `base: "/app/"` would bake `/app/assets/x.js` into the
  // HTML instead, a URL nothing on disk answers to: the request would fall
  // through the asset router, hit the Worker's `/app/*` catch-all, and get
  // served the dashboard shell's own HTML in place of the script — 200,
  // wrong content, and every status-code-only test would still pass.
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The world atlas is ~90KB gzipped and only the map needs it.
    chunkSizeWarningLimit: 700,
  },
});
