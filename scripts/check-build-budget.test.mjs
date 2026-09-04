import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkBuildBudget } from "./check-build-budget.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "margiolink-budget-"));
  await mkdir(join(directory, "assets"));
  return directory;
}

test("reports oversized gzip JavaScript and unwanted font subsets", async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "assets", "app.js"), randomBytes(181 * 1024));
  await writeFile(join(directory, "assets", "font-cyrillic.woff2"), "font");

  const violations = checkBuildBudget(directory);

  assert.ok(violations.length >= 2);
  assert.match(violations.join("\n"), /app\.js.*180 KiB/);
  assert.match(violations.join("\n"), /font-cyrillic\.woff2.*font subset/);
});

test("accepts small JavaScript and Latin-only font artifacts", async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "assets", "app.js"), "export const ok = true;\n");
  await writeFile(join(directory, "assets", "font-latin.woff2"), "font");
  await writeFile(join(directory, "assets", "font-latin-ext.woff2"), "font");

  assert.deepEqual(checkBuildBudget(directory), []);
});
