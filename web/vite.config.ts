import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { version } from "../package.json" with { type: "json" };

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
  // Baked into the built JS as a literal at build time — see
  // `vite-env.d.ts` for the declaration and the About group in
  // `src/pages/Settings.tsx` for where it's read. Not served by the API
  // (`GET /api/meta`, `src/routes/api/meta.ts`): the version a reader wants
  // here is the one in the assets they're looking at, not one a Worker that
  // could be a step ahead or behind that build might report.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The world atlas is ~90KB gzipped and only the map needs it.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      /**
       * Two documents, and which one is `index.html` matters.
       *
       * Cloudflare's static-asset router serves a matching file *before* the
       * Worker script runs, and with the default `html_handling`
       * ("auto-trailing-slash") the file it serves at `/` is the asset root's
       * `index.html`. So whatever is called `index.html` here is what an
       * anonymous visitor to the bare domain gets — which is why the public
       * landing page holds that name and the dashboard shell, which nobody
       * signed out should be served, is `app.html`.
       *
       * `app.html` is reached two ways, both correct: the asset router
       * answers `/app` with it directly, and the Worker's own `/app` and
       * `/app/*` routes fetch it through the `ASSETS` binding for every
       * client-side route below it (`src/routes/public.ts`).
       */
      input: {
        landing: new URL("index.html", import.meta.url).pathname,
        app: new URL("app.html", import.meta.url).pathname,
      },
    },
  },
  server: {
    fs: {
      // `index.html` embeds screenshots from `docs/screenshots/`, one level
      // above this Vite root. The build resolves them regardless; this is
      // what lets `npm run dev:web` serve them too instead of refusing the
      // path as outside the root.
      allow: [".."],
    },
  },
});
