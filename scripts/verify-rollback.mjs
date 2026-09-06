#!/usr/bin/env node
// Proves the most recent migration is genuinely reversible.
//
// Applies every migration, records the schema, rolls the latest one back,
// checks the schema actually changed, re-applies, and checks the schema came
// back identical. The middle check matters: a down file that does nothing
// would otherwise pass, because the schema before and after would match.
//
// Only the latest migration is exercised, which is what `scripts/rollback.mjs`
// reverses and the only rollback that is ever safe to automate. Each migration
// gets checked while it is the latest — that is, on the pull request that adds
// it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const DB = "margiolink";
const migrationFiles = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationName = migrationFiles.at(-1);

if (!migrationName) {
  console.error("Rollback verification FAILED: no migrations found in migrations/");
  process.exit(1);
}
const persistTo = mkdtempSync(join(tmpdir(), "margiolink-rollback-"));

function withPersistence(args) {
  return [...args, "--persist-to", persistTo];
}

function run(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...withPersistence(args)], {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
}

function schema() {
  const raw = run(
    [
      "d1",
      "execute",
      DB,
      "--local",
      "--json",
      "--command",
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
    ],
    { capture: true },
  );

  const parsed = JSON.parse(raw);
  const rows = parsed[0]?.results ?? [];
  return rows
    .filter((row) => row.name !== "d1_migrations")
    .map((row) => `${row.type} ${row.name}\n${row.sql ?? ""}`)
    .join("\n\n");
}

function appliedMigration(name) {
  const raw = run(
    [
      "d1",
      "execute",
      DB,
      "--local",
      "--json",
      "--command",
      `SELECT name FROM d1_migrations WHERE name = '${name}' LIMIT 1`,
    ],
    { capture: true },
  );
  const parsed = JSON.parse(raw);
  return (parsed[0]?.results ?? []).length === 1;
}

function fail(message, detail) {
  console.error(`\nRollback verification FAILED: ${message}\n`);
  if (detail) console.error(detail);
  throw new Error(message);
}

try {
  console.log(JSON.stringify({ event: "rollback_verification_started", migration: migrationName }));
  console.log("1/4 applying migrations");
  run(["d1", "migrations", "apply", DB, "--local"]);
  if (!appliedMigration(migrationName)) {
    fail(`migration was not recorded as applied: ${migrationName}`);
  }
  const before = schema();

  if (before.trim() === "") {
    fail("no schema after applying migrations — nothing to verify");
  }

  console.log(`2/4 rolling back explicitly: ${basename(migrationName, ".sql")}`);
  execFileSync(
    "node",
    ["scripts/rollback.mjs", "--local", "--persist-to", persistTo, "--migration", migrationName],
    { stdio: "inherit" },
  );
  const rolledBack = schema();

  if (rolledBack === before) {
    fail(
      "the schema is unchanged after rollback — the down file did nothing",
      "A rollback that leaves the schema identical is not a rollback. Check that\n" +
        "the newest file in rollback/ actually reverses its migration.",
    );
  }

  console.log("3/4 re-applying migrations");
  run(["d1", "migrations", "apply", DB, "--local"]);
  if (!appliedMigration(migrationName)) {
    fail(`migration was not recorded after re-apply: ${migrationName}`);
  }
  const after = schema();

  console.log("4/4 comparing");
  if (after !== before) {
    fail(
      "the schema did not come back identical after re-applying",
      `--- before rollback ---\n${before}\n\n--- after re-apply ---\n${after}`,
    );
  }

  console.log(
    JSON.stringify({ event: "rollback_verified", migration: migrationName, schemaRestored: true }),
  );
} finally {
  rmSync(persistTo, { recursive: true, force: true });
}
