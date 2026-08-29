import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  ACTIONS,
  DEFAULT_PORT_RANGE,
  MIN_NODE_VERSION,
  PACKAGE_NAME,
  assertPluginManifest,
  buildPayload,
  checkNode,
  choosePort,
  compareVersions,
  minimumVersionSatisfied,
  npmInstallArgs,
  parsePluginManifest,
  processMatchesRecord,
  requirePayload,
  renderLaunchdPlist,
  renderSystemdUnit,
  resolveTargetIdentity,
  runAction,
  selectSupervisor,
  selectTarget,
  serviceName,
  STARTUP_COMMAND,
  targetRecordPath,
  validateConfig,
  validatePluginManifest,
  waitForReadiness,
  withTargetLock,
} from "./herdr-world-plugin.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_VERSION = parsePluginManifest(readFileSync(path.join(ROOT, "herdr-plugin.toml"), "utf8")).version;

function temporaryDirectory(prefix = "herdr-world-plugin-test-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function executableScript(pathname, body) {
  writeFileSync(pathname, body);
  chmodSync(pathname, 0o755);
}

test("the checked-in manifest declares the exact plugin contract", () => {
  const manifest = parsePluginManifest(readFileSync(path.join(ROOT, "herdr-plugin.toml"), "utf8"));
  assert.doesNotThrow(() => assertPluginManifest(manifest));
  assert.equal(manifest.version, MANIFEST_VERSION);
  const startup = manifest.blocks.find((entry) => entry.type === "startup");
  assert.deepEqual(startup?.command, ["bash", "scripts/herdr-world-plugin.sh", STARTUP_COMMAND]);
  assert.deepEqual(ACTIONS, ["build", "start", "stop", "restart", "status", "open", "doctor"]);
});

test("manifest validation rejects panes and malformed startup hooks or actions", () => {
  const manifest = parsePluginManifest(readFileSync(path.join(ROOT, "herdr-plugin.toml"), "utf8"));
  manifest.blocks.push({ type: "panes", id: "world", command: ["sh"] });
  assert.match(validatePluginManifest(manifest).join("\n"), /must not declare \[\[panes\]\]/);
  manifest.blocks.find((entry) => entry.type === "startup").command = ["sh", "start"];
  assert.match(validatePluginManifest(manifest).join("\n"), /exact startup hook command/);
});

test("release versions use strict stable or numbered RC syntax", () => {
  assert.equal(compareVersions("0.1.0-rc.5", "0.1.0"), -1);
  assert.equal(compareVersions("0.1.1", "0.1.0-rc.5"), 1);
  assert.equal(minimumVersionSatisfied("22.14.0", MIN_NODE_VERSION), true);
  assert.equal(minimumVersionSatisfied("22.13.9", MIN_NODE_VERSION), false);
  assert.equal(minimumVersionSatisfied("22.14.0-beta.1", MIN_NODE_VERSION), false);
  assert.throws(() => checkNode(process.execPath, { runner: () => "v22.13.9" }), /22.14.0 or newer/);
});

test("target selection enforces the published platform and libc matrix", () => {
  assert.deepEqual(selectTarget({ platform: "linux", arch: "x64", glibcVersion: "2.39" }).target, "linux-x64");
  assert.deepEqual(selectTarget({ platform: "darwin", arch: "arm64" }).target, "macos-arm64");
  assert.deepEqual(selectTarget({ platform: "darwin", arch: "x64" }).target, "macos-x64");
  assert.throws(() => selectTarget({ platform: "linux", arch: "arm64", glibcVersion: "2.39" }), /unsupported/);
  assert.throws(() => selectTarget({ platform: "linux", arch: "x64", glibcVersion: "2.33" }), /glibc 2.34/);
  assert.throws(() => selectTarget({ platform: "linux", arch: "x64", glibcVersion: "musl" }), /glibc/);
});

test("configuration validates safe remote access and mutually exclusive targets", () => {
  assert.deepEqual(validateConfig({}).port_range, DEFAULT_PORT_RANGE);
  assert.throws(() => validateConfig({ host: "0.0.0.0" }), /allowed_hosts and allowed_origins/);
  assert.doesNotThrow(() => validateConfig({
    host: "0.0.0.0",
    allowed_hosts: ["world.example"],
    allowed_origins: ["https://world.example"],
  }));
  assert.throws(() => validateConfig({ session_name: "a", socket_path: "/tmp/herdr.sock" }), /mutually exclusive/);
  assert.throws(() => validateConfig({ allowed_origins: ["https://world.example/path"] }), /allowed_origins/);
  assert.throws(() => validateConfig({ host: "https://world.example" }), /hostname or IP/);
});

test("npm installation is exact, private, script-free, and registry-pinned", () => {
  assert.deepEqual(npmInstallArgs("0.1.0-rc.5", ".herdr-world-plugin"), [
    "install",
    "--registry=https://registry.npmjs.org/",
    "--@ivoryheart:registry=https://registry.npmjs.org/",
    "--prefix",
    ".herdr-world-plugin",
    "--ignore-scripts",
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    `${PACKAGE_NAME}@0.1.0-rc.5`,
  ]);
  assert.doesNotMatch(npmInstallArgs("0.1.0-rc.5").join(" "), /latest|next|npx|--global/);
});

test("missing private payload reports the exact recovery command", () => {
  const root = temporaryDirectory();
  try {
    assert.throws(
      () => requirePayload(root, "0.1.0-rc.5", "linux-x64"),
      /npm install --registry=https:\/\/registry\.npmjs\.org\/.*@ivoryheart\/herdr-world@0\.1\.0-rc\.5/s,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build installs and verifies the exact payload using a private prefix", () => {
  const root = temporaryDirectory();
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(root, "herdr-plugin.toml"), readFileSync(path.join(ROOT, "herdr-plugin.toml")));
  const log = path.join(root, "npm-args.json");
  const fakeNpm = path.join(bin, "npm");
  const manifestVersion = JSON.stringify(MANIFEST_VERSION);
  executableScript(fakeNpm, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("11.5.1"); process.exit(0); }
fs.writeFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args));
const prefix = args[args.indexOf("--prefix") + 1];
const packageRoot = path.join(prefix, "node_modules/@ivoryheart/herdr-world");
fs.mkdirSync(path.join(packageRoot, "lib/bridges/linux-x64"), { recursive: true });
fs.mkdirSync(path.join(packageRoot, "share/herdr-world/web/legal"), { recursive: true });
fs.mkdirSync(path.join(prefix, "node_modules/.bin"), { recursive: true });
fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@ivoryheart/herdr-world", version: ${manifestVersion} }));
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM.md", "lib/herdr-world-launcher.sh", "share/herdr-world/web/index.html"]) fs.writeFileSync(path.join(packageRoot, file), "ok");
  fs.writeFileSync(path.join(packageRoot, "share/herdr-world/web/legal/manifest.json"), JSON.stringify({ schema_version: 1, files: [] }));
  for (const file of [path.join(packageRoot, "lib/bridges/linux-x64/herdr-world-bridge"), path.join(prefix, "node_modules/.bin/herdr-world"), path.join(packageRoot, "lib/herdr-world-launcher.sh")]) { fs.writeFileSync(file, "#!/bin/sh\\n"); fs.chmodSync(file, 0o755); }
`);
  try {
    buildPayload({
      root,
      env: { ...process.env, PATH: bin, FAKE_NPM_LOG: log },
      nodePath: process.execPath,
      npmPath: fakeNpm,
      platform: "linux",
      arch: "x64",
      glibcVersion: "2.39",
    });
    const args = JSON.parse(readFileSync(log, "utf8"));
    assert.equal(args.at(-1), `${PACKAGE_NAME}@${MANIFEST_VERSION}`);
    assert.equal(args[args.indexOf("--ignore-scripts")], "--ignore-scripts");
    assert.equal(args[args.indexOf("--registry=https://registry.npmjs.org/")], "--registry=https://registry.npmjs.org/");
    assert.equal(args[args.indexOf("--@ivoryheart:registry=https://registry.npmjs.org/")], "--@ivoryheart:registry=https://registry.npmjs.org/");
    assert.equal(fsExists(path.join(root, ".herdr-world-plugin/node_modules/@ivoryheart/herdr-world/package.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("port allocation keeps the default port fixed and separates named targets", async () => {
  const state = temporaryDirectory();
  try {
    const config = validateConfig({ session_name: "secondary", port_range: [8787, 8789] });
    const first = await choosePort(config, "session:first", state, { portFree: async (host, port) => port !== 8787 });
    assert.equal(first, 8788);
    await assert.rejects(
      choosePort(validateConfig({ port_range: [8787, 8787] }), "socket:default", state, { portFree: async () => false }),
      /default bridge port/,
    );
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("distinct injected sockets allocate another default-range port without config changes", async () => {
  const state = temporaryDirectory();
  try {
    const config = validateConfig({});
    assert.equal(await choosePort(config, "socket:first", state, { portFree: async () => true }), 8787);
    mkdirSync(path.join(state, "runtimes"), { recursive: true });
    writeFileSync(path.join(state, "runtimes", "first.json"), JSON.stringify({ target_identity: "socket:first", port: 8787 }));
    assert.equal(
      await choosePort(config, "socket:second", state, { portFree: async (host, port) => port !== 8787 }),
      8788,
    );
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("restart validates its start plan before stopping the existing service", async () => {
  const configDir = temporaryDirectory("herdr-world-plugin-config-");
  const stateDir = temporaryDirectory("herdr-world-plugin-state-");
  const env = {
    ...process.env,
    HERDR_PLUGIN_CONFIG_DIR: configDir,
    HERDR_PLUGIN_STATE_DIR: stateDir,
    HERDR_SOCKET_PATH: path.join(stateDir, "herdr.sock"),
    HERDR_WORLD_NODE_PATH: path.join(stateDir, "missing-node"),
  };
  try {
    const target = resolveTargetIdentity(validateConfig({}), env);
    const recordPath = targetRecordPath(stateDir, target.identity);
    mkdirSync(path.dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, JSON.stringify({
      schema_version: 1,
      target_identity: target.identity,
      package_name: PACKAGE_NAME,
      service_name: serviceName(target.identity, "fallback"),
      supervisor: "fallback",
      pid: 999999999,
    }));
    await assert.rejects(
      runAction("restart", { root: ROOT, env, platform: "linux", arch: "x64", glibcVersion: "2.39" }),
      /required executable is not available/,
    );
    assert.equal(fsExists(recordPath), true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("readiness requires bridge, Herdr, protocol, and web compatibility", async () => {
  const response = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body, body: { cancel: async () => {} } });
  const expected = { package_version: "0.1.0-rc.5" };
  await assert.rejects(
    waitForReadiness("http://127.0.0.1:8787", expected, {
      timeoutMs: 120,
      fetchImpl: async () => response({ bridge_api_version: 1, herdr_version: "0.8.2", terminal_protocol: 19, web_compat: 1 }),
    }),
    /terminal protocol 19/,
  );
  const capabilities = await waitForReadiness("http://127.0.0.1:8787", expected, {
    fetchImpl: async () => response({ bridge_api_version: 1, herdr_version: "0.8.2", terminal_protocol: 20, web_compat: 1 }),
  });
  assert.equal(capabilities.terminal_protocol, 20);
});

test("service ownership rejects command or signature drift", () => {
  const record = {
    node_path: "/usr/bin/node",
    payload_entrypoint: "/managed/.bin/herdr-world",
    bridge_args: ["--host", "127.0.0.1", "--port", "8787"],
    command_signature: "not-the-command-signature",
  };
  assert.equal(processMatchesRecord(record, "/usr/bin/node /managed/.bin/herdr-world --host 127.0.0.1 --port 8787"), false);
});

test("supervisor fakes select only the user-owned platform supervisors", () => {
  const root = temporaryDirectory();
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const fakeSystemctl = path.join(bin, "systemctl");
  const fakeLaunchctl = path.join(bin, "launchctl");
  executableScript(fakeSystemctl, "#!/bin/sh\nexit 0\n");
  executableScript(fakeLaunchctl, "#!/bin/sh\nexit 0\n");
  try {
    assert.equal(selectSupervisor("linux", { PATH: bin, HERDR_WORLD_SYSTEMCTL: fakeSystemctl }).kind, "systemd-user");
    assert.equal(selectSupervisor("darwin", { PATH: bin, HERDR_WORLD_LAUNCHCTL: fakeLaunchctl }).kind, "launchd");
    assert.equal(selectSupervisor("linux", { PATH: path.join(root, "missing") }).kind, "fallback");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supervisor definitions contain the absolute Node command and safe environment", () => {
  const record = {
    node_path: "/opt/node/bin/node",
    payload_entrypoint: "/managed/.herdr-world-plugin/node_modules/.bin/herdr-world",
    bridge_args: ["--host", "127.0.0.1", "--port", "8787"],
    service_name: "herdr-world-owned.service",
  };
  const environment = {
    HERDR_SOCKET_PATH: "/private/herdr.sock",
    HERDR_WORLD_SETUP: "never",
    PATH: "/usr/bin",
  };
  const unit = renderSystemdUnit(record, environment);
  assert.match(unit, /ExecStart="\/opt\/node\/bin\/node" "\/managed\/\.herdr-world-plugin\/node_modules\/\.bin\/herdr-world"/);
  assert.match(unit, /Environment="HERDR_WORLD_SETUP=never"/);
  assert.match(unit, /Environment="HERDR_SOCKET_PATH=\/private\/herdr\.sock"/);
  const plist = renderLaunchdPlist(record, environment, "/private/service.log");
  assert.match(plist, /<key>ProgramArguments<\/key>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>/);
  assert.match(plist, /<key>HERDR_WORLD_SETUP<\/key><string>never<\/string>/);
});

test("release workflow gates the three-platform plugin smoke on npm publication", () => {
  const workflow = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const npmJob = workflow.indexOf("  npm_publish:");
  const pluginJob = workflow.indexOf("  plugin_smoke:");
  assert.ok(npmJob >= 0 && pluginJob > npmJob);
  assert.match(workflow.slice(pluginJob, workflow.indexOf("  homebrew_publish:", pluginJob)), /needs: \[npm_publish\]/);
  assert.match(workflow.slice(pluginJob, workflow.indexOf("  homebrew_publish:", pluginJob)), /live-plugin-smoke\.sh/);
  assert.equal((workflow.match(/platform: linux-x86_64/g) ?? []).length >= 2, true);
  assert.match(workflow.slice(pluginJob), /platform: macos-arm64/);
  assert.match(workflow.slice(pluginJob), /platform: macos-x86_64/);
  assert.match(workflow, /package_path="\$\{GITHUB_WORKSPACE\}\/npm-output\/herdr-world-\$\{VERSION\}\.tgz"/);
});

test("documents and tests the explicit stop-before-uninstall contract", () => {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const packaging = readFileSync(path.join(ROOT, "docs/packaging.md"), "utf8");
  const smoke = readFileSync(path.join(ROOT, "scripts/live-plugin-smoke.sh"), "utf8");
  assert.match(readme, /herdr plugin action invoke stop --plugin ivoryheart\.herdr-world/);
  assert.match(readme, /herdr plugin uninstall ivoryheart\.herdr-world/);
  assert.match(readme, /asynchronous and target-\s*scoped/);
  assert.match(readme, /every Herdr target or named\s*session/);
  assert.match(readme, /status: succeeded/);
  assert.match(readme, /herdr --session NAME plugin action invoke stop/);
  assert.match(packaging, /stop the plugin bridge before uninstalling the plugin/);
  assert.match(packaging, /actions are asynchronous and target-scoped/);
  assert.match(smoke, /Installing .* while Herdr is stopped/);
  assert.match(smoke, /plugin install .*--ref/);
  assert.ok(smoke.indexOf('plugin install IvoryHeart/herdr-world') < smoke.indexOf('echo "Starting stock Herdr release smoke daemon and restoring the plugin service"'));
  assert.ok(smoke.indexOf("invoke_default stop") < smoke.indexOf('plugin uninstall "$PLUGIN_ID"'));
  assert.match(smoke, /no uninstall hook/);
});

test("target locks are atomic and cleaned up after completion", async () => {
  const state = temporaryDirectory();
  try {
    const result = await withTargetLock(state, "socket:/tmp/herdr.sock", async () => "locked");
    assert.equal(result, "locked");
    assert.equal(readFileNames(path.join(state, "runtimes")).some((name) => name.endsWith(".lock")), false);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

function fsExists(pathname) {
  try { readFileSync(pathname); return true; } catch { return false; }
}

function readFileNames(directory) {
  try { return readdirSync(directory); } catch { return []; }
}
