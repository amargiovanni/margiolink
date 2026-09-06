/**
 * Types for `demo-sql.mjs`. See the note at the top of `demo-data.d.mts` for
 * why these modules are JavaScript with declarations beside them rather than
 * TypeScript.
 */

import type { DemoData } from "./demo-data.mjs";

/**
 * Dimension name → the SQL expression the rollup aggregates for it. A copy of
 * `DIMENSION_COLUMNS` in `src/db/stats.ts`, deliberately not typed against it:
 * the point of the copy is that this module has no dependency on the Worker's
 * module graph, and `test/demo-seed.test.ts` compares the two values at
 * runtime, which catches a changed expression as well as a changed key.
 */
export declare const ROLLUP_DIMENSIONS: Record<string, string>;

/** High-cardinality dimensions that production and the demo rollup suppress
 *  below three clicks per link/day. */
export declare const SENSITIVE_ROLLUP_DIMENSIONS: ReadonlySet<string>;

/** The `clicks` columns the seed writes, in insert order — every column of the
 *  table except its `id`. */
export declare const CLICK_COLUMNS: readonly string[];

/** The whole dataset as SQL statements, in the order they must run: reset,
 *  inserts, then the rollup. */
export declare function buildSeedStatements(data: DemoData): string[];
