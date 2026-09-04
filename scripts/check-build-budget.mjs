#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const MAX_GZIP_JAVASCRIPT_BYTES = 180 * 1024;
const UNWANTED_FONT_SUBSET = /(?:cyrillic|greek|vietnamese)/i;
const FONT_EXTENSION = /\.(?:woff2?|ttf|otf)$/i;

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export function checkBuildBudget(directory) {
  const violations = [];

  for (const file of filesBelow(directory)) {
    const name = basename(file);
    const label = relative(directory, file);

    if (name.endsWith(".js")) {
      const gzipBytes = gzipSync(readFileSync(file)).byteLength;
      if (gzipBytes > MAX_GZIP_JAVASCRIPT_BYTES) {
        violations.push(
          `${label} is ${(gzipBytes / 1024).toFixed(1)} KiB gzip; JavaScript budget is 180 KiB`,
        );
      }
    }

    if (FONT_EXTENSION.test(name) && UNWANTED_FONT_SUBSET.test(name)) {
      violations.push(`${label} contains an unwanted non-Latin font subset`);
    }
  }

  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? "web/dist";
  try {
    const violations = checkBuildBudget(directory);
    if (violations.length > 0) {
      console.error(`Build budget failed:\n- ${violations.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("Build budget passed.");
    }
  } catch (error) {
    console.error(`Build budget could not inspect ${directory}:`, error);
    process.exitCode = 1;
  }
}
