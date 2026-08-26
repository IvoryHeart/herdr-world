#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "third_party", "dependencies");
const CARGO_OUTPUT = "cargo-licenses.html";
const NPM_OUTPUT = "npm-licenses.txt";
const CARGO_ABOUT_VERSION = "cargo-about 0.9.2";
const NPM_GENERATOR_VERSION = "4.2.3";
const CARGO_TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
];

const mode = process.argv[2] ?? "--generate";
if (!["--generate", "--check"].includes(mode) || process.argv.length > 3) {
  console.error("Usage: node scripts/dependency-notices.mjs [--generate|--check]");
  process.exit(2);
}

function output(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "pipe" : "inherit"],
  }).trim();
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: "inherit",
  });
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function assertToolVersions() {
  const cargoAboutVersion = output("cargo", ["about", "--version"], { quiet: true });
  if (cargoAboutVersion !== CARGO_ABOUT_VERSION) {
    fail(`expected ${CARGO_ABOUT_VERSION}; found ${cargoAboutVersion || "nothing"}`);
  }

  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (rootPackage.devDependencies?.["generate-license-file"] !== NPM_GENERATOR_VERSION) {
    fail(`package.json must pin generate-license-file ${NPM_GENERATOR_VERSION}`);
  }

  const installedPackage = JSON.parse(
    readFileSync(join(ROOT, "node_modules", "generate-license-file", "package.json"), "utf8"),
  );
  if (installedPackage.version !== NPM_GENERATOR_VERSION) {
    fail(
      `expected generate-license-file ${NPM_GENERATOR_VERSION}; found ${installedPackage.version}`,
    );
  }
}

function generate(destination) {
  mkdirSync(destination, { recursive: true });

  run("cargo", [
    "about",
    "generate",
    "--locked",
    "--fail",
    "--manifest-path",
    join(ROOT, "bridge", "Cargo.toml"),
    "--output-file",
    join(destination, CARGO_OUTPUT),
    join(ROOT, "bridge", "about.hbs"),
  ]);

  const cargoNoticePath = join(destination, CARGO_OUTPUT);
  const normalizedCargoNotice = readFileSync(cargoNoticePath, "utf8")
    .replace(/\r\n/gu, "\n")
    .replace(/[\t ]+$/gmu, "");
  writeFileSync(cargoNoticePath, normalizedCargoNotice);

  run(join(ROOT, "node_modules", ".bin", "generate-license-file"), [
    "--input",
    join(ROOT, "package.json"),
    "--input",
    join(ROOT, "web", "package.json"),
    "--output",
    join(destination, NPM_OUTPUT),
    "--overwrite",
    "--eol",
    "lf",
    "--ci",
    "--no-spinner",
  ]);
}

function npmRuntimeComponents() {
  const components = new Set();
  for (const cwd of [ROOT, join(ROOT, "web")]) {
    const tree = JSON.parse(output("npm", ["ls", "--omit=dev", "--all", "--json"], { cwd }));
    const visit = (node) => {
      for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
        components.add(`${name}@${dependency.version}`);
        visit(dependency);
      }
    };
    visit(tree);
  }
  return components;
}

function generatedNpmComponents(contents) {
  return new Set(
    [...contents.matchAll(/^ - (.+@[^\n]+)$/gm)].map((match) => match[1]),
  );
}

function normalizeCargoTreeLine(line) {
  let normalized = line.trim();
  normalized = normalized.replace(/ \(\*\)$/u, "");
  normalized = normalized.replace(/ \(proc-macro\)/gu, "");
  normalized = normalized.replace(/ \((?:\/|[A-Za-z]:[\\/]).*\)$/u, "");
  normalized = normalized.replace(/^([^ ]+) v/u, "$1 ");
  return normalized;
}

function cargoRuntimeComponents() {
  const components = new Set();
  for (const target of CARGO_TARGETS) {
    const tree = output("cargo", [
      "tree",
      "--locked",
      "--manifest-path",
      join(ROOT, "bridge", "Cargo.toml"),
      "--target",
      target,
      "--edges",
      "normal,build",
      "--prefix",
      "none",
      "--format",
      "{p}",
    ]);
    for (const line of tree.split("\n")) {
      const component = normalizeCargoTreeLine(line);
      if (component) components.add(component);
    }
  }
  return components;
}

function generatedCargoComponents(contents) {
  return new Set(
    [...contents.matchAll(/<li><a href="[^"]*">([^<]+)<\/a><\/li>/g)].map((match) =>
      match[1].trim(),
    ),
  );
}

function assertSameComponents(label, expected, actual) {
  const missing = [...expected].filter((component) => !actual.has(component)).sort();
  const extra = [...actual].filter((component) => !expected.has(component)).sort();
  if (missing.length || extra.length) {
    fail(
      `${label} notice inventory does not match the runtime closure:\n` +
        `missing: ${missing.join(", ") || "none"}\n` +
        `extra: ${extra.join(", ") || "none"}`,
    );
  }
}

function validate(destination) {
  const npmContents = readFileSync(join(destination, NPM_OUTPUT));
  const cargoContents = readFileSync(join(destination, CARGO_OUTPUT));
  const npmText = npmContents.toString("utf8");
  const cargoText = cargoContents.toString("utf8");

  const expectedNpm = npmRuntimeComponents();
  const expectedCargo = cargoRuntimeComponents();
  assertSameComponents("npm", expectedNpm, generatedNpmComponents(npmText));
  assertSameComponents("Cargo", expectedCargo, generatedCargoComponents(cargoText));

  return {
    npmCount: expectedNpm.size,
    cargoCount: expectedCargo.size,
    npmSha256: sha256(npmContents),
    cargoSha256: sha256(cargoContents),
  };
}

function assertCurrent(generatedDirectory) {
  for (const name of [CARGO_OUTPUT, NPM_OUTPUT]) {
    const expected = readFileSync(join(OUTPUT_DIR, name));
    const actual = readFileSync(join(generatedDirectory, name));
    if (!expected.equals(actual)) {
      fail(`${name} is stale; run npm run notices:generate`);
    }
  }
}

let temporaryDirectory;
try {
  assertToolVersions();
  const destination =
    mode === "--check"
      ? (temporaryDirectory = mkdtempSync(join(tmpdir(), "herdr-world-notices-")))
      : OUTPUT_DIR;
  generate(destination);
  const summary = validate(destination);
  if (mode === "--check") assertCurrent(destination);
  console.log(
    `Dependency notices ${mode === "--check" ? "verified" : "generated"}: ` +
      `${summary.npmCount} npm (${summary.npmSha256}), ` +
      `${summary.cargoCount} Cargo (${summary.cargoSha256})`,
  );
} finally {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}
