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

const DB = "margiolink";

function run(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
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

function fail(message, detail) {
  console.error(`\nRollback verification FAILED: ${message}\n`);
  if (detail) console.error(detail);
  process.exit(1);
}

console.log("1/4 applying migrations");
run(["d1", "migrations", "apply", DB, "--local"]);
const before = schema();

if (before.trim() === "") {
  fail("no schema after applying migrations — nothing to verify");
}

console.log("2/4 rolling back the latest migration");
execFileSync("node", ["scripts/rollback.mjs", "--local"], { stdio: "inherit" });
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
const after = schema();

console.log("4/4 comparing");
if (after !== before) {
  fail(
    "the schema did not come back identical after re-applying",
    `--- before rollback ---\n${before}\n\n--- after re-apply ---\n${after}`,
  );
}

console.log("\nRollback verified: schema changed on rollback and returned identical on re-apply.");
