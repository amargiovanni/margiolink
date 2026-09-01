import type { D1Migration } from "cloudflare:test";
import type { Env as AppEnv } from "./src/types";

// NOTE: the installed @cloudflare/vitest-pool-workers version types the deprecated
// `cloudflare:test` `env` export as `Cloudflare.Env` (a global namespace from
// @cloudflare/workers-types), not as an augmentable `ProvidedEnv` interface inside
// the "cloudflare:test" module. Augmenting the global namespace is what actually
// makes `env.DB` / `env.TEST_MIGRATIONS` type-check in tests.
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }

  // The project's `lib` deliberately excludes "DOM" and no "node" types are
  // installed, so `import.meta.url` (used in vitest.config.ts, which runs
  // under Node) has no ambient type without this minimal augmentation.
  interface ImportMeta {
    readonly url: string;
  }
}

declare module "*.sql?raw" {
  const contents: string;
  export default contents;
}
