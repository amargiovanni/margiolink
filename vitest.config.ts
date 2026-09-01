import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(new URL("./migrations", import.meta.url).pathname);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          ADMIN_USER: "admin",
          ADMIN_PASSWORD: "correct-horse-battery-staple",
          HASH_SECRET: "test-hash-secret-not-a-real-one",
          SHORT_DOMAIN: "link.test",
          RAW_RETENTION_DAYS: "180",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
