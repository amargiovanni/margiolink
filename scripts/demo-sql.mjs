/**
 * The demo dataset, as SQL.
 *
 * Pure like `demo-data.mjs` and for the same reason: `test/demo-seed.test.ts`
 * imports it inside `workerd` and runs what it emits against a real D1, which
 * is the only way to find out whether this file's SQL is valid SQL and
 * whether its aggregation agrees with the one in `src/cron/rollup.ts`.
 */

/**
 * The dimensions the rollup materialises, and the expression each aggregates.
 *
 * A copy of `DIMENSION_COLUMNS` in `src/db/stats.ts`, and a copy on purpose —
 * this file is plain JavaScript run by `node`, and the original is TypeScript
 * compiled into a Worker. `test/demo-seed.test.ts` compares the two sets
 * key-by-key and expression-by-expression, in both directions, so the copy
 * cannot drift without a failing test saying exactly which key moved.
 */
export const ROLLUP_DIMENSIONS = {
  country: "country",
  city: "city",
  device: "device_type",
  os: "os",
  browser: "browser",
  referrer_type: "referrer_type",
  referrer_host: "referrer_host",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  language: "language",
  asn_org: "asn_org",
  source: "source",
  outcome: "outcome",
  dow_hour: "strftime('%w', ts, 'unixepoch') || '-' || strftime('%H', ts, 'unixepoch')",
};

/** SQLite string literal: single quotes doubled, NULL for absent values.
 *  Every value in the demo dataset comes from a literal pool in
 *  `demo-data.mjs`, so this is belt-and-braces rather than load-bearing — but
 *  a seed that concatenates SQL should escape it whether or not today's data
 *  happens to need escaping. */
function text(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function integer(value) {
  if (value === null || value === undefined) return "NULL";
  if (!Number.isFinite(value)) throw new Error(`demo-sql: ${value} is not a number`);
  return String(Math.trunc(value));
}

/**
 * D1 rejects a statement longer than 100 KB with `SQLITE_TOOBIG`, so batches
 * are bounded by the length of the SQL they produce rather than by a row
 * count. 64 KB leaves room for a row wider than today's widest without
 * anybody having to remember to lower a magic number.
 *
 * Found the way these things usually are: batching 500 clicks at a time built
 * a 121 KB statement and every seed failed with `statement too long`.
 */
const MAX_STATEMENT_BYTES = 64 * 1024;

/**
 * One `INSERT` for as many rows as fit, rather than one per row.
 *
 * 19,000 single-row inserts is 19,000 round trips through D1's statement
 * handling and takes minutes; the same rows in ~100 KB-bounded batches is
 * around a hundred statements and takes seconds. Literal SQL is used
 * throughout, so the bound-parameter ceiling that usually decides batch size
 * does not apply here — only the length one above does.
 */
function insertMany(table, columns, rows, toValues) {
  const statements = [];
  const header = `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n  `;
  let batch = [];
  let bytes = header.length;

  const flush = () => {
    if (batch.length > 0) statements.push(`${header}${batch.join(",\n  ")};`);
    batch = [];
    bytes = header.length;
  };

  for (const row of rows) {
    const tuple = `(${toValues(row).join(",")})`;
    if (batch.length > 0 && bytes + tuple.length > MAX_STATEMENT_BYTES) flush();
    batch.push(tuple);
    bytes += tuple.length + 4;
  }
  flush();

  return statements;
}

/**
 * Aggregate every day in the table in one pass per dimension.
 *
 * `src/cron/rollup.ts` aggregates one named day at a time, because in
 * production it runs hourly over the day in progress and the one before it.
 * Doing that 180 times here would be 180 × 16 statements for no benefit, so
 * the day is grouped rather than bound — `date(ts, 'unixepoch')` produces
 * exactly the `YYYY-MM-DD` string `rollupDay` binds, and the `GROUP BY`
 * positions match its own (`link_id, 4`, the value column). The result is
 * row-for-row identical, which `test/demo-seed.test.ts` asserts by running
 * both and diffing the tables.
 */
function rollupStatements() {
  const statements = [
    "DELETE FROM click_daily;",
    "DELETE FROM click_daily_dim;",
    `INSERT INTO click_daily (day, link_id, clicks, uniques, bots)
SELECT date(ts, 'unixepoch'),
       link_id,
       SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END),
       COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END),
       SUM(is_bot)
FROM clicks
GROUP BY 1, 2;`,
  ];

  for (const [name, column] of Object.entries(ROLLUP_DIMENSIONS)) {
    statements.push(
      `INSERT INTO click_daily_dim (day, link_id, dimension, value, clicks, uniques)
SELECT date(ts, 'unixepoch'),
       link_id,
       ${text(name)},
       COALESCE(NULLIF(${column}, ''), 'unknown'),
       COUNT(*),
       COUNT(DISTINCT visitor_hash)
FROM clicks
WHERE is_bot = 0
GROUP BY 1, 2, 4;`,
    );
  }

  return statements;
}

/**
 * Everything this seed owns, deleted before it is rewritten.
 *
 * Named explicitly rather than swept from `sqlite_master`: `admin_sessions`
 * and `login_attempts` are also application tables, and wiping the session
 * you are looking at the dashboard through — mid-screenshot — is a surprise
 * nobody asked the seed for. `sqlite_sequence` is reset so the link ids in
 * `docs/screenshots/` URLs stay stable across re-seeds.
 */
function resetStatements() {
  return [
    "DELETE FROM click_daily_dim;",
    "DELETE FROM click_daily;",
    "DELETE FROM clicks;",
    "DELETE FROM link_tags;",
    "DELETE FROM links;",
    "DELETE FROM tags;",
    "DELETE FROM sqlite_sequence WHERE name IN ('links', 'tags', 'clicks');",
  ];
}

const CLICK_COLUMNS = [
  "link_id",
  "ts",
  "visitor_hash",
  "source",
  "outcome",
  "is_bot",
  "continent",
  "country",
  "region",
  "city",
  "timezone",
  "asn_org",
  "colo",
  "device_type",
  "os",
  "os_version",
  "browser",
  "browser_version",
  "language",
  "referrer_host",
  "referrer_type",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
];

export { CLICK_COLUMNS };

/**
 * @param {ReturnType<import("./demo-data.mjs").generateDemoData>} data
 *   With `passwordHash`/`passwordSalt` already filled in on any link that has
 *   a `password` — hashing is 100,000 PBKDF2 iterations and belongs to the
 *   caller, not to a string builder.
 * @returns {string[]} Statements, in the order they must run.
 */
export function buildSeedStatements(data) {
  return [
    ...resetStatements(),

    ...insertMany("tags", ["id", "name", "color"], data.tags, (tag) => [
      integer(tag.id),
      text(tag.name),
      text(tag.color),
    ]),

    ...insertMany(
      "links",
      [
        "id",
        "slug",
        "target_url",
        "title",
        "description",
        "password_hash",
        "password_salt",
        "expires_at",
        "expired_url",
        "is_active",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      data.links,
      (link) => [
        integer(link.id),
        text(link.slug),
        text(link.targetUrl),
        text(link.title),
        text(link.description),
        text(link.passwordHash ?? null),
        text(link.passwordSalt ?? null),
        integer(link.expiresAt),
        text(link.expiredUrl),
        integer(link.isActive),
        integer(link.createdAt),
        integer(link.updatedAt),
        integer(link.deletedAt),
      ],
    ),

    ...insertMany("link_tags", ["link_id", "tag_id"], data.linkTags, (row) => [
      integer(row.linkId),
      integer(row.tagId),
    ]),

    ...insertMany("clicks", CLICK_COLUMNS, data.clicks, (click) => [
      integer(click.linkId),
      integer(click.ts),
      text(click.visitorHash),
      text(click.source),
      text(click.outcome),
      integer(click.isBot),
      text(click.continent),
      text(click.country),
      text(click.region),
      text(click.city),
      text(click.timezone),
      text(click.asnOrg),
      text(click.colo),
      text(click.deviceType),
      text(click.os),
      text(click.osVersion),
      text(click.browser),
      text(click.browserVersion),
      text(click.language),
      text(click.referrerHost),
      text(click.referrerType),
      text(click.utmSource),
      text(click.utmMedium),
      text(click.utmCampaign),
      text(click.utmTerm),
      text(click.utmContent),
    ]),

    ...rollupStatements(),
  ];
}
