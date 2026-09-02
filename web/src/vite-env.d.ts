/// <reference types="vite/client" />

/** Injected by Vite's `define` in `vite.config.ts` from `package.json`'s
 *  `version` — a build-time literal, not a runtime value. Read in the About
 *  group of `pages/Settings.tsx`. Deliberately not served by `GET
 *  /api/meta`: see that route's own comment for why. */
declare const __APP_VERSION__: string;
