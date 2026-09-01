#!/usr/bin/env node

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const output = join(root, "_site");
const assets = join(output, "assets");

rmSync(output, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

for (const file of ["index.html", "styles.css", "site.js"]) {
  copyFileSync(join(root, "site", file), join(output, file));
}

for (const file of [
  "graph-live-terminals.png",
  "graph-overview.png",
  "pixel-office-desktop.png",
  "pixel-office-mobile.png",
  "social-preview.png",
]) {
  copyFileSync(join(root, "docs", "images", file), join(assets, file));
}

copyFileSync(
  join(root, "web", "public", "herdr-logo.svg"),
  join(assets, "herdr-logo.svg"),
);
writeFileSync(join(output, ".nojekyll"), "");

console.log(`Built GitHub Pages site at ${output}`);
