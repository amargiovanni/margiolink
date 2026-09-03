#!/usr/bin/env node
// Fills the LOCAL D1 database with a demo dataset: six months of links, tags
// and clicks, spread across countries, devices, channels and hours, so a
// fresh clone shows the dashboard doing its job instead of sixteen empty
// states.
//
//   npm run db:seed:demo              180 days, the default seed
//   node scripts/seed-demo.mjs --days 30
//   node scripts/seed-demo.mjs --seed 7    a different, equally repeatable set
//
// The same arguments always produce the same rows (`scripts/demo-data.mjs` is
// deterministic), which is what makes `npm run screenshots` reproducible.
//
// LOCAL ONLY, and it enforces that below rather than trusting the flag: this
// script DELETES every row in `links`, `tags`, `link_tags`, `clicks` and both
// rollup tables before writing its own. Pointing it at a production database
// would destroy real link history — including slugs people have already
// shared, which is not something a restore fully undoes. There is deliberately
// no `--remote`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_PASSWORD, generateDemoData } from "./demo-data.mjs";
import { buildSeedStatements } from "./demo-sql.mjs";

const DB = "margiolink";

if (process.argv.includes("--remote")) {
  console.error(
    "seed-demo: refusing --remote. This script deletes every link, tag and click\n" +
      "in the database it runs against; it exists to fill a local database with\n" +
      "fabricated data, and there is no version of that which belongs in production.",
  );
  process.exit(1);
}

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value)) {
    console.error(`seed-demo: --${name} needs a number`);
    process.exit(1);
  }
  return value;
}

const days = flag("days", 180);
const seed = flag("seed", 20260903);
const now = Math.floor(Date.now() / 1000);

/**
 * The one link with a password gets a real PBKDF2 hash, computed exactly as
 * `hashPassword` in `src/lib/crypto.ts` does it — same 100,000 iterations,
 * same SHA-256, same hex salt — so the interstitial in the screenshots is a
 * working password prompt a reader can actually open, not a dead end. Node's
 * `crypto.subtle` and workerd's are both WebCrypto, so "exactly as" is a
 * property of the algorithm parameters rather than a hope.
 */
async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

console.log(`seed-demo: generating ${days} days of demo data (seed ${seed})`);
const data = generateDemoData({ now, days, seed });

for (const link of data.links) {
  if (!link.password) continue;
  // A fixed salt, like the password itself: the point of this dataset is that
  // two runs produce identical rows, and a random salt would change the
  // `links` table on every seed for no security gained — the database is
  // local and the password is printed in this file's output.
  link.passwordSalt = "5eed5eed5eed5eed5eed5eed5eed5eed";
  link.passwordHash = await hashPassword(link.password, link.passwordSalt);
}

const statements = buildSeedStatements(data);
const sql = `${statements.join("\n\n")}\n`;

// A temp file rather than `--command`: the whole dataset is several megabytes
// of SQL, well past what an argument vector will carry, and `wrangler d1
// execute --file` is the supported way to hand it over.
const directory = mkdtempSync(join(tmpdir(), "margiolink-seed-"));
const file = join(directory, "seed-demo.sql");

try {
  writeFileSync(file, sql);
  console.log(
    `seed-demo: ${data.links.length} links, ${data.tags.length} tags, ` +
      `${data.clicks.length.toLocaleString("en-US")} clicks ` +
      `(${data.window.firstDay} → ${data.window.lastDay}), ` +
      `${statements.length} statements, ${(sql.length / 1e6).toFixed(1)} MB of SQL`,
  );
  console.log("seed-demo: applying to the local database…");
  execFileSync("npx", ["wrangler", "d1", "execute", DB, "--local", "--file", file, "--yes"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const protectedLink = data.links.find((link) => link.password);

console.log(`
seed-demo: done.

  Dashboard   http://localhost:8787/app   (ADMIN_USER / ADMIN_PASSWORD from .dev.vars)
  A link      http://localhost:8787/${data.links[0].slug}
  Protected   http://localhost:8787/${protectedLink.slug}   password: ${protectedLink.password ?? DEMO_PASSWORD}

Run \`npm run dev\` if it is not already up. Re-running this script rebuilds
the same dataset from scratch — it is not additive.
`);
