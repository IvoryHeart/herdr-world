#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINATION = join(ROOT, "web", "dist", "legal");
const FILES = [
  ["LICENSE.txt", "LICENSE"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["UPSTREAM.md", "UPSTREAM.md"],
  ["world-assets.md", "docs/world-assets.md"],
  ["Apache-2.0.txt", "third_party/licenses/Apache-2.0.txt"],
  ["PixiJS-MIT.txt", "third_party/licenses/PixiJS-MIT.txt"],
  ["npm-licenses.txt", "third_party/dependencies/npm-licenses.txt"],
];

mkdirSync(DESTINATION, { recursive: true });
const manifest = { schema_version: 1, files: [] };

for (const [destinationName, sourceName] of FILES) {
  const source = join(ROOT, sourceName);
  const destination = join(DESTINATION, destinationName);
  const contents = readFileSync(source);
  copyFileSync(source, destination);
  manifest.files.push({
    path: destinationName,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

writeFileSync(join(DESTINATION, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Staged ${FILES.length} legal files in web/dist/legal`);
