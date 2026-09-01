#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const DB = "margiolink";
const target = process.argv.includes("--remote") ? "--remote" : "--local";

const files = readdirSync("rollback")
  .filter((f) => f.endsWith(".down.sql"))
  .sort();

const last = files.at(-1);
if (!last) {
  console.error("No rollback files found in rollback/");
  process.exit(1);
}

const migrationName = last.replace(".down.sql", ".sql");

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", DB, target, "--file", `rollback/${last}`, "--yes"],
  {
    stdio: "inherit",
  },
);
execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    DB,
    target,
    "--command",
    `DELETE FROM d1_migrations WHERE name = '${migrationName}'`,
    "--yes",
  ],
  { stdio: "inherit" },
);

console.log(`Rolled back ${migrationName}`);
