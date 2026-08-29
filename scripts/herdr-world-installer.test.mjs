import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerSource = resolve(root, "scripts/herdr-world-installer.sh");
const launcherSource = resolve(root, "scripts/herdr-world-launcher.sh");

function makeBundle(testRoot) {
  const bundle = join(testRoot, "herdr-world-v0.0.0-test-linux-x86_64");
  mkdirSync(join(bundle, "bin"), { recursive: true });
  mkdirSync(join(bundle, "share/herdr-world/web"), { recursive: true });
  writeFileSync(join(bundle, "VERSION"), "v0.0.0-test\n");
  writeFileSync(join(bundle, "share/herdr-world/web/index.html"), "<!doctype html>\n");
  cpSync(installerSource, join(bundle, "install"));
  cpSync(installerSource, join(bundle, "bin/herdr-world-installer"));
  cpSync(launcherSource, join(bundle, "bin/herdr-world"));
  writeFileSync(
    join(bundle, "bin/herdr-world-bridge"),
    "#!/usr/bin/env bash\nprintf '<%s>\\n' \"$@\"\n",
  );
  for (const executable of [
    "install",
    "bin/herdr-world-installer",
    "bin/herdr-world",
    "bin/herdr-world-bridge",
  ]) {
    chmodSync(join(bundle, executable), 0o755);
  }
  return bundle;
}

function installerEnvironment(testRoot) {
  const home = join(testRoot, "home");
  const dataHome = join(home, ".local/share");
  const commandDir = join(home, ".local/bin");
  mkdirSync(home, { recursive: true });
  return {
    env: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: dataHome,
      HERDR_WORLD_BIN_DIR: commandDir,
      HERDR_CLIENT_SOCKET_PATH: "",
      HERDR_SESSION: "",
      HERDR_SOCKET_PATH: "",
      HERDR_WORLD_SETUP: "auto",
    },
    commandDir,
    installTarget: join(dataHome, "herdr-world/v0.0.0-test"),
  };
}

test("the bundle installer creates versioned commands and the installed launcher resolves its assets", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "herdr-world-installer-test-"));
  try {
    const bundle = makeBundle(testRoot);
    const { env, commandDir, installTarget } = installerEnvironment(testRoot);
    const result = spawnSync("/bin/bash", [join(bundle, "install"), "--install-only"], {
      cwd: testRoot,
      encoding: "utf8",
      env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed Herdr World v0\.0\.0-test/);
    assert.equal(existsSync(join(installTarget, "share/herdr-world/web/index.html")), true);
    assert.equal(lstatSync(join(commandDir, "herdr-world")).isSymbolicLink(), true);
    assert.equal(lstatSync(join(commandDir, "herdr-world-installer")).isSymbolicLink(), true);
    assert.equal(
      readlinkSync(join(commandDir, "herdr-world")),
      join(installTarget, "bin/herdr-world"),
    );

    const launch = spawnSync(join(commandDir, "herdr-world"), ["--help"], {
      cwd: testRoot,
      encoding: "utf8",
      env,
    });
    assert.equal(launch.status, 0, launch.stderr);
    assert.match(launch.stdout, /Usage: herdr-world/);
    assert.doesNotMatch(launch.stdout, /static-dir/);

    writeFileSync(join(bundle, "share/herdr-world/web/index.html"), "updated\n");
    const reinstall = spawnSync("/bin/bash", [join(bundle, "install"), "--install-only"], {
      cwd: testRoot,
      encoding: "utf8",
      env,
    });
    assert.equal(reinstall.status, 0, reinstall.stderr);
    assert.equal(
      readFileSync(join(installTarget, "share/herdr-world/web/index.html"), "utf8"),
      "updated\n",
    );

    const installedRerun = spawnSync(
      join(commandDir, "herdr-world-installer"),
      ["--install-only"],
      { cwd: testRoot, encoding: "utf8", env },
    );
    assert.equal(installedRerun.status, 0, installedRerun.stderr);
    assert.match(installedRerun.stdout, /is already installed/);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test("the installer can hand off directly to the installed application command", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "herdr-world-installer-launch-test-"));
  try {
    const bundle = makeBundle(testRoot);
    const { env, installTarget } = installerEnvironment(testRoot);
    const result = spawnSync("/bin/bash", [join(bundle, "install"), "--", "--help"], {
      cwd: testRoot,
      encoding: "utf8",
      env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Continuing with Herdr dependency setup/);
    assert.match(result.stdout, /Usage: herdr-world/);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test("the installer refuses to replace an unrelated command", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "herdr-world-installer-conflict-test-"));
  try {
    const bundle = makeBundle(testRoot);
    const { env, commandDir, installTarget } = installerEnvironment(testRoot);
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(join(commandDir, "herdr-world"), "unrelated\n");

    const result = spawnSync("/bin/bash", [join(bundle, "install"), "--install-only"], {
      cwd: testRoot,
      encoding: "utf8",
      env,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to replace the existing non-symlink command/);
    assert.equal(existsSync(installTarget), false);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
