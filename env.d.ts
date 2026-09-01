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

  // NOTE: a wildcard ambient module declaration (`declare module "*.sql?raw"`)
  // is visible outside this file only while it sits inside `declare global`.
  // At the top level of this module file (this file has top-level imports
  // above, so it *is* a module) it would type-check imports in this file
  // alone — every other file importing a `*.sql?raw` module would still see
  // "Cannot find module". Nesting it here is what makes it program-wide.
  declare module "*.sql?raw" {
    const contents: string;
    export default contents;
  }

  // Same reasoning as the `*.sql?raw` declaration above: this must stay
  // nested inside `declare global` to be visible outside this file.
  declare module "*.md?raw" {
    const contents: string;
    export default contents;
  }
}
