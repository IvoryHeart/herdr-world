import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  homebrewFormulaName,
  npmDistributionTag,
  readCurrentReleaseTag,
} from "./release-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "_site");
const currentRelease = readCurrentReleaseTag(root);

function buildPages() {
  execFileSync(process.execPath, [join(root, "scripts", "build-pages.mjs")], {
    cwd: root,
    stdio: "pipe",
  });
}

test("the Pages artifact is self-contained and release-accurate", () => {
  buildPages();

  const expectedFiles = [
    "index.html",
    "styles.css",
    "site.js",
    ".nojekyll",
    "assets/graph-live-terminals.png",
    "assets/graph-overview.png",
    "assets/herdr-logo.svg",
    "assets/pixel-office-desktop.png",
    "assets/pixel-office-mobile.png",
    "assets/social-preview.png",
  ];

  for (const file of expectedFiles) {
    assert.ok(existsSync(join(output, file)), `missing Pages artifact: ${file}`);
  }

  const html = readFileSync(join(output, "index.html"), "utf8");
  assert.match(html, /<main id="main">/);
  assert.match(html, /class="skip-link"/);
  assert.ok(html.includes(currentRelease));
  assert.match(html, /Public preview \/ Linux \+ macOS/);
  assert.match(html, /macOS previews are currently unsigned/i);
  assert.match(html, /control surface for your agents/i);
  assert.doesNotMatch(html, /control surface for Herdr agents/i);
  assert.match(html, /Protocol[\s\S]{0,80}<dd>20<\/dd>/i);
  assert.match(html, /assets\/pixel-office-desktop\.png/);
  assert.match(html, /assets\/pixel-office-mobile\.png/);
  assert.match(html, /assets\/graph-overview\.png/);
  assert.match(html, /assets\/graph-live-terminals\.png/);
  assert.match(html, /role="region"[^>]+aria-roledescription="carousel"/);
  assert.equal([...html.matchAll(/data-carousel-slide/g)].length, 3);
  assert.match(html, /data-carousel-toggle/);
  assert.match(html, /property="og:image"[^>]+social-preview\.png/);
  assert.match(html, /role="tablist"[^>]+aria-label="Herdr World installation methods"/);
  assert.match(html, /data-install-tab="npm"/);
  assert.match(html, /data-install-tab="brew"/);
  assert.match(html, /data-install-tab="herdr"/);
  assert.match(html, /data-install-tab="cli"/);
  assert.match(html, /data-install-tab="cli">CLI<\/button>/);
  assert.match(
    html,
    new RegExp(
      "npm install --global @ivoryheart/herdr-world@" + npmDistributionTag(currentRelease),
    ),
  );
  assert.ok(html.includes(`@ivoryheart/herdr-world@${currentRelease.slice(1)}`));
  assert.match(
    html,
    new RegExp("brew install IvoryHeart/tap/" + homebrewFormulaName(currentRelease)),
  );
  assert.match(html, new RegExp("herdr plugin install IvoryHeart/herdr-world --ref " + currentRelease));
  assert.match(html, /<details class="install-advanced">/);
  assert.ok(html.includes(`data-install-command="cli">VERSION=${currentRelease}`));
  assert.match(html, /curl -fLO .*herdr-world-\$\{VERSION\}-\$\{PLATFORM\}\.tar\.gz/);
  assert.match(html, /tar -xzf .*herdr-world-\$\{VERSION\}-\$\{PLATFORM\}\.tar\.gz/);
  assert.doesNotMatch(html, /Runtime and Herdr plugin commands/);
  assert.doesNotMatch(html, /Download the RC|current release candidate|preview Formula/);
  const siteJs = readFileSync(join(output, "site.js"), "utf8");
  assert.match(siteJs, /data-install-tab/);
  assert.match(siteJs, /data-carousel/);
  assert.match(siteJs, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, "local references must be relative");
  assert.doesNotMatch(html, /file:\/\//, "local filesystem URLs must not ship");

  const localReferences = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)]
    .map((match) => match[1]);
  for (const reference of localReferences) {
    assert.ok(
      existsSync(join(output, reference.slice(2))),
      `broken local reference: ${reference}`,
    );
  }
});
