#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const platform = process.platform === "win32" ? "windows" : process.platform;
const id = `${platform}-${process.arch}`;
const supported = new Set([
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
]);
if (!supported.has(id)) {
  console.error(`Herdr World has no release binary for ${id}`);
  process.exit(1);
}
if (
  platform === "linux" &&
  !process.report?.getReport()?.header.glibcVersionRuntime
) {
  console.error("Herdr World requires glibc on Linux");
  process.exit(1);
}

const packageName = `@ivoryheart/herdr-world-${id}`;
let binary;
try {
  const packageJson = fileURLToPath(
    import.meta.resolve(`${packageName}/package.json`),
  );
  const platformVersion = JSON.parse(readFileSync(packageJson, "utf8")).version;
  const launcherVersion = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
  if (platformVersion !== launcherVersion) {
    throw new Error("platform package version differs from the launcher");
  }
  binary = join(
    dirname(packageJson),
    "bin",
    platform === "windows" ? "herdr-world.exe" : "herdr-world",
  );
} catch (error) {
  console.error(
    `Cannot use ${packageName}: ${error.message}. Reinstall with npm optional dependencies enabled.`,
  );
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`Could not start Herdr World: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode =
    code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1);
});
