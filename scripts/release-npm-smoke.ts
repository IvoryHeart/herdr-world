/** Install and launch the actual packed launcher and native payload, offline. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  exerciseRuntime,
  runtimeEnvironment,
  removeInstallerFixture,
} from "./installer-upgrade";

const version = process.argv[2]!;
const platform = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const root = mkdtempSync(join(tmpdir(), "release-npm-"));
try {
  mkdirSync(join(root, "home"), { mode: 0o700 });
  const packages = [platform, ""].map((target) =>
    join(
      process.cwd(),
      "dist/npm-tarballs",
      `ivoryheart-herdr-world${target ? "-" + target : ""}-${version}.tgz`,
    ),
  );
  const node = Bun.which("node")!;
  const npm = Bun.which("npm")!;
  const installArgs = [
    "install",
    "--ignore-scripts",
    "--offline",
    "--prefix",
    root,
    ...packages,
  ];
  if (process.platform === "win32")
    execFileSync(
      node,
      [join(dirname(npm), "node_modules/npm/bin/npm-cli.js"), ...installArgs],
      { stdio: "inherit" },
    );
  else execFileSync(npm, installArgs, { stdio: "inherit" });
  const binary = join(
    root,
    "node_modules/@ivoryheart/herdr-world/bin/herdr-world.mjs",
  );
  // Launch through Node's published launcher rather than extracting its binary.
  assert.equal(
    execFileSync(node, [binary, "--version"], { encoding: "utf8" }).trim(),
    `herdr-world ${version}`,
  );
  await exerciseRuntime(
    node,
    root,
    runtimeEnvironment(join(root, "home")),
    undefined,
    200,
    [binary],
  );
} finally {
  await removeInstallerFixture(root);
}
