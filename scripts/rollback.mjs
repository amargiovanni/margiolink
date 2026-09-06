#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const DB = "margiolink";

function usage(message) {
  if (message) console.error(`Rollback failed: ${message}`);
  console.error(
    "Usage: node scripts/rollback.mjs --migration <migration.sql> [--local|--remote] [--persist-to <dir>]",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const targetFlags = args.filter((arg) => arg === "--local" || arg === "--remote");
if (targetFlags.length > 1) usage("choose either --local or --remote");
const target = targetFlags[0] ?? "--local";

let migrationName;
let persistTo;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--migration") migrationName = args[++index];
  if (args[index] === "--persist-to") persistTo = args[++index];
}

if (!migrationName) usage("a migration ID is required; refusing to choose one implicitly");
if (!migrationName.endsWith(".sql")) migrationName += ".sql";
if (!/^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/.test(migrationName)) {
  usage(`invalid migration ID: ${migrationName}`);
}

const rollbackFile = migrationName.replace(/\.sql$/, ".down.sql");
if (!readdirSync("rollback").includes(rollbackFile)) {
  usage(`rollback file not found: rollback/${rollbackFile}`);
}

function run(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
}

function migrationQuery() {
  const args = [
    "d1",
    "execute",
    DB,
    target,
    "--json",
    "--command",
    `SELECT name FROM d1_migrations WHERE name = '${migrationName}' LIMIT 1`,
  ];
  if (persistTo) args.push("--persist-to", persistTo);
  const parsed = JSON.parse(run(args, { capture: true }));
  return parsed[0]?.results ?? [];
}

function latestAppliedMigration() {
  const args = [
    "d1",
    "execute",
    DB,
    target,
    "--json",
    "--command",
    "SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1",
  ];
  if (persistTo) args.push("--persist-to", persistTo);
  const parsed = JSON.parse(run(args, { capture: true }));
  return parsed[0]?.results?.[0]?.name;
}

if (migrationQuery().length !== 1) {
  usage(`migration is not applied in the selected database: ${migrationName}`);
}
if (latestAppliedMigration() !== migrationName) {
  usage(`only the latest applied migration may be rolled back: ${migrationName}`);
}

const prefix = persistTo ? ["--persist-to", persistTo] : [];
console.log(JSON.stringify({ event: "rollback_started", migration: migrationName, target }));
run(["d1", "execute", DB, target, "--file", `rollback/${rollbackFile}`, ...prefix, "--yes"]);
run([
  "d1",
  "execute",
  DB,
  target,
  "--command",
  `DELETE FROM d1_migrations WHERE name = '${migrationName}'`,
  ...prefix,
  "--yes",
]);

if (migrationQuery().length !== 0) {
  usage(`migration tracking row still exists after rollback: ${migrationName}`);
}

console.log(JSON.stringify({ event: "rollback_completed", migration: migrationName, target }));
