import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { version } from "./package.json" with { type: "json" };

const migrations = await readD1Migrations(new URL("./migrations", import.meta.url).pathname);

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: migrations,
                ADMIN_USER: "admin",
                ADMIN_PASSWORD: "correct-horse-battery-staple",
                HASH_SECRET: "8f4c2e91a7d6b3c0e5f8291d4a6b7c8e9f0a1b2c3d4e5f60718293a4b5c6d7e8",
                SHORT_DOMAIN: "link.test",
                RAW_RETENTION_DAYS: "180",
              },
            },
          }),
        ],
        test: {
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        plugins: [react()],
        // Mirrors `web/vite.config.ts`'s own `define` — `Settings.test.tsx`
        // renders the About group, which reads `__APP_VERSION__`. Without
        // this the constant is simply undefined under Vitest's transform,
        // which never runs the real build config.
        define: {
          __APP_VERSION__: JSON.stringify(version),
        },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["web/src/**/*.test.{ts,tsx}"],
          setupFiles: ["./web/src/test-setup.ts"],
          globals: true,
          // Vitest's own default (`css: { include: [] }`) replaces every CSS
          // import — including a `?raw` one — with an empty string to skip
          // processing it; `tokens.test.ts` reads `tokens.css` this way, so
          // without this it silently gets `""` instead of the file's content.
          css: { include: [/\.css/] },
        },
      },
    ],
  },
});
