import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
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
  applyRemoteAccessAction,
  configWithRemoteAccess,
  minimumVersionSatisfied,
  nodeMatchesRecord,
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
  normalizeRemoteAccess,
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

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launchdFixture({ real = false } = {}) {
  const root = temporaryDirectory("herdr-world-launchd-test-");
  const bin = path.join(root, "bin");
  const configDir = path.join(root, "config");
  const stateDir = path.join(root, "state");
  const packageRoot = path.join(root, ".herdr-world-plugin/node_modules/@ivoryheart/herdr-world");
  const entrypoint = path.join(root, ".herdr-world-plugin/node_modules/.bin/herdr-world");
  const socketPath = path.join(root, "herdr.sock");
  const port = await freePort();
  mkdirSync(bin, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  for (const target of ["macos-arm64", "macos-x64"]) mkdirSync(path.join(packageRoot, `lib/bridges/${target}`), { recursive: true });
  mkdirSync(path.join(packageRoot, "share/herdr-world/web/legal"), { recursive: true });
  mkdirSync(path.dirname(entrypoint), { recursive: true });
  writeFileSync(path.join(root, "herdr-plugin.toml"), readFileSync(path.join(ROOT, "herdr-plugin.toml")));
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ port, port_range: [port, port] }));
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version: MANIFEST_VERSION }));
  writeFileSync(path.join(packageRoot, "share/herdr-world/web/index.html"), "<title>fixture</title>");
  writeFileSync(path.join(packageRoot, "share/herdr-world/web/legal/manifest.json"), JSON.stringify({ schema_version: 1, files: [] }));
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM.md"]) writeFileSync(path.join(packageRoot, file), "fixture");
  for (const target of ["macos-arm64", "macos-x64"]) {
    executableScript(path.join(packageRoot, `lib/bridges/${target}/herdr-world-bridge`), "#!/bin/sh\nexit 0\n");
  }
  executableScript(path.join(packageRoot, "lib/herdr-world-launcher.sh"), "#!/bin/sh\nexit 0\n");
  executableScript(entrypoint, `#!/usr/bin/env node
const http = require("node:http");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const server = http.createServer((request, response) => {
  if (request.url === "/api/capabilities") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ bridge_api_version: 1, herdr_version: "0.8.2", terminal_protocol: 20, web_compat: 1 }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<title>fixture</title>");
});
server.listen(port, "127.0.0.1");
`);
  const herdr = path.join(bin, "herdr");
  executableScript(herdr, `#!/usr/bin/env node
console.log(JSON.stringify({ running: true, status: "running", compatible: true, version: "0.8.2", protocol: 20, socket: process.env.HERDR_SOCKET_PATH }));
`);
  const fakeLaunchctl = path.join(bin, "launchctl");
  const statePath = path.join(bin, "service.pid");
  const logPath = path.join(bin, "launchctl.log");
  const commandPath = path.join(bin, "service-command.json");
  const failPath = path.join(bin, "bootstrap-fails");
  const cleanupFailPath = path.join(bin, "bootout-fails");
  executableScript(fakeLaunchctl, `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const bin = path.dirname(path.resolve(process.argv[1]));
const args = process.argv.slice(2);
const statePath = path.join(bin, "service.pid");
const logPath = path.join(bin, "launchctl.log");
const commandPath = path.join(bin, "service-command.json");
const failPath = path.join(bin, "bootstrap-fails");
const cleanupFailPath = path.join(bin, "bootout-fails");
const servicePath = path.join(bin, "service.plist");
appendFileSync(logPath, JSON.stringify(args) + "\\n");
if (args[0] === "print") {
  const service = args[1]?.split("/").length === 3;
  if (!service) process.exit(0);
  if (!existsSync(statePath)) process.exit(1);
  const pid = readFileSync(statePath, "utf8").trim();
  const plistPath = existsSync(servicePath) ? readFileSync(servicePath, "utf8") : "";
  process.stdout.write("pid = " + pid + "\\nstate = running\\n");
  if (plistPath) process.stdout.write("path = " + plistPath + "\\n");
  process.exit(0);
}
if (args[0] === "bootstrap") {
  const command = JSON.parse(readFileSync(commandPath, "utf8"));
  const child = spawn(command[0], command.slice(1), { detached: true, stdio: "ignore" });
  child.unref();
  writeFileSync(statePath, String(child.pid));
  writeFileSync(servicePath, args[2]);
  if (existsSync(failPath)) {
    rmSync(failPath, { force: true });
    process.stderr.write("fixture bootstrap failed\\n");
    process.exit(7);
  }
  process.exit(0);
}
if (args[0] === "bootout") {
  if (existsSync(cleanupFailPath)) {
    process.stderr.write("fixture bootout failed\\n");
    process.exit(8);
  }
  if (existsSync(statePath)) {
    const pid = Number(readFileSync(statePath, "utf8"));
    try { process.kill(pid, "SIGTERM"); } catch {}
    rmSync(statePath, { force: true });
    rmSync(servicePath, { force: true });
  }
  process.exit(0);
}
process.exit(0);
`);
  writeFileSync(commandPath, JSON.stringify([process.execPath, entrypoint, "--host", "127.0.0.1", "--port", String(port)]));
  const socketServer = net.createServer();
  await new Promise((resolve, reject) => {
    socketServer.once("error", reject);
    socketServer.listen(socketPath, resolve);
  });
  const env = {
    ...process.env,
    HERDR_PLUGIN_CONFIG_DIR: configDir,
    HERDR_PLUGIN_STATE_DIR: stateDir,
    HERDR_SOCKET_PATH: socketPath,
    HERDR_BIN_PATH: herdr,
    HERDR_WORLD_NODE_PATH: process.execPath,
  };
  if (!real) env.HERDR_WORLD_LAUNCHCTL = fakeLaunchctl;
  return {
    root,
    port,
    socketPath,
    socketServer,
    stateDir,
    statePath,
    logPath,
    failPath,
    cleanupFailPath,
    env,
  };
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

test("doctor compares the recorded service Node path with Node metadata", () => {
  const record = { node_path: process.execPath };
  assert.equal(nodeMatchesRecord(record, { path: process.execPath, version: "22.14.0" }), true);
  assert.equal(nodeMatchesRecord(record, `${process.execPath}`), false);
  assert.equal(nodeMatchesRecord(record, { path: "/missing/node", version: "22.14.0" }), false);
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
  assert.throws(() => validateConfig({ host: "0.0.0.0" }), /allowed_hosts/);
  assert.doesNotThrow(() => validateConfig({
    host: "0.0.0.0",
    allowed_hosts: ["world.example"],
  }));
  assert.doesNotThrow(() => validateConfig({
    host: "0.0.0.0",
    allowed_hosts: ["world.example"],
    allowed_origins: ["https://world.example"],
  }));
  assert.throws(() => validateConfig({ session_name: "a", socket_path: "/tmp/herdr.sock" }), /mutually exclusive/);
  assert.throws(() => validateConfig({ allowed_origins: ["https://world.example/path"] }), /allowed_origins/);
  assert.throws(() => validateConfig({ host: "https://world.example" }), /hostname or IP/);
});

test("remote access needs a served address but additional page origins are optional", () => {
  assert.deepEqual(normalizeRemoteAccess({
    remote_access: {
      enabled: true,
      accepted_hosts: ["world.example"],
      allowed_page_origins: [],
      allowed_bridge_origins: [],
    },
  }), {
    enabled: true,
    accepted_hosts: ["world.example"],
    allowed_page_origins: [],
    allowed_bridge_origins: [],
    password_hash: null,
  });
});

test("legacy host policies migrate without losing directional IPv6 bridge permissions", () => {
  const config = validateConfig({
    host: "0.0.0.0",
    allowed_hosts: ["[2001:db8::20]"],
    allowed_origins: ["https://world.example.test"],
    allowed_connect_origins: ["http://bridge.example.test:4000"],
  });
  assert.deepEqual(config.remote_access, {
    enabled: true,
    accepted_hosts: ["2001:db8::20"],
    allowed_page_origins: ["https://world.example.test"],
    allowed_bridge_origins: ["http://bridge.example.test:4000"],
    password_hash: null,
  });
  assert.deepEqual(normalizeRemoteAccess(config), config.remote_access);
});

test("remote access preserves the configured IPv6 bind family", () => {
  const config = validateConfig({
    host: "::",
    allowed_hosts: ["2001:db8::20"],
    allowed_origins: ["https://[2001:db8::20]:8787"],
  });
  assert.equal(config.host, "::");

  const enabled = configWithRemoteAccess(config, {
    enabled: true,
    accepted_hosts: ["2001:db8::20"],
    allowed_page_origins: ["https://[2001:db8::20]:8787"],
    allowed_bridge_origins: [],
  });
  assert.equal(enabled.host, "::");
  assert.equal(net.isIP(enabled.host), 6);

  const disabled = configWithRemoteAccess(enabled, {
    ...enabled.remote_access,
    enabled: false,
  });
  assert.equal(disabled.host, "::1");
});

test("remote access keeps an IPv4 page reachable when accepted hosts include IPv6", () => {
  const config = validateConfig({
    host: "127.0.0.1",
    allowed_hosts: [],
    allowed_origins: [],
  });
  const enabled = configWithRemoteAccess(config, {
    enabled: true,
    accepted_hosts: ["192.0.2.20", "2001:db8::20"],
    allowed_page_origins: ["http://192.0.2.20:8787"],
    allowed_bridge_origins: [],
  });
  assert.equal(enabled.host, "0.0.0.0");
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
  const localPackage = path.join(root, `herdr-world-v${MANIFEST_VERSION}.tgz`);
  writeFileSync(localPackage, "release candidate fixture");
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
      env: {
        ...process.env,
        PATH: bin,
        FAKE_NPM_LOG: log,
        HERDR_WORLD_PLUGIN_PACKAGE: localPackage,
      },
      nodePath: process.execPath,
      npmPath: fakeNpm,
      platform: "linux",
      arch: "x64",
      glibcVersion: "2.39",
    });
    const args = JSON.parse(readFileSync(log, "utf8"));
    assert.equal(args.at(-1), localPackage);
    assert.equal(args[args.indexOf("--ignore-scripts")], "--ignore-scripts");
    assert.equal(args[args.indexOf("--registry=https://registry.npmjs.org/")], "--registry=https://registry.npmjs.org/");
    assert.equal(args[args.indexOf("--@ivoryheart:registry=https://registry.npmjs.org/")], "--@ivoryheart:registry=https://registry.npmjs.org/");
    assert.equal(fsExists(path.join(root, ".herdr-world-plugin/node_modules/@ivoryheart/herdr-world/package.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build rejects a relative local release-candidate package path", () => {
  const root = temporaryDirectory();
  try {
    writeFileSync(path.join(root, "herdr-plugin.toml"), readFileSync(path.join(ROOT, "herdr-plugin.toml")));
    assert.throws(
      () => buildPayload({
        root,
        env: { ...process.env, HERDR_WORLD_PLUGIN_PACKAGE: "candidate.tgz" },
        nodePath: process.execPath,
        npmPath: process.execPath,
        platform: "linux",
        arch: "x64",
        glibcVersion: "2.39",
      }),
      /HERDR_WORLD_PLUGIN_PACKAGE must be an absolute path/,
    );
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

test("LAN readiness probes use an accepted Host while connecting through loopback", async () => {
  const response = (body) => ({ ok: true, status: 200, json: async () => body, body: { cancel: async () => {} } });
  const expected = {
    package_version: "0.1.0-rc.5",
    host: "0.0.0.0",
    port: 8787,
    bridge_args: ["--host", "0.0.0.0", "--allow-host", "bridge.example.test"],
  };
  let requestOptions;
  await waitForReadiness("http://127.0.0.1:8787", expected, {
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return response({ bridge_api_version: 1, herdr_version: "0.8.2", terminal_protocol: 20, web_compat: 1 });
    },
  });
  assert.equal(requestOptions.headers.host, "bridge.example.test:8787");
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

test("launchd bootstraps RunAtLoad services once and unloads partial startup", async () => {
  const fixture = await launchdFixture();
  fixture.env.HOSTNAME = "workstation.local";
  const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: "arm64" };
  try {
    const record = await runAction("start", options);
    assert.equal(record.supervisor, "launchd");
    assert.equal(record.controller_mode, "launchd");
    assert.equal(record.port, fixture.port);
    const plistName = readdirSync(path.join(fixture.stateDir, "supervisors"))
      .find((name) => name.endsWith(".plist"));
    assert.ok(plistName);
    const serviceDefinition = readFileSync(
      path.join(fixture.stateDir, "supervisors", plistName),
      "utf8",
    );
    assert.match(serviceDefinition, /<key>HOSTNAME<\/key><string>workstation\.local<\/string>/);
    const commands = readFileSync(fixture.logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(commands.some((args) => args[0] === "bootstrap"));
    assert.equal(commands.some((args) => args[0] === "kickstart"), false);
    assert.ok(commands.some((args) => args[0] === "print" && args[1].split("/").length === 3));

    const bootstrapCount = () => readFileSync(fixture.logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((args) => args[0] === "bootstrap").length;
    const beforeIdempotentStart = bootstrapCount();
    const sameRecord = await runAction("start", options);
    assert.equal(sameRecord.service_name, record.service_name);
    assert.equal(bootstrapCount(), beforeIdempotentStart);

    await runAction("stop", options);
    assert.equal(fsExists(fixture.statePath), false);

    const bootoutCount = () => readFileSync(fixture.logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((args) => args[0] === "bootout").length;
    writeFileSync(fixture.statePath, "999999\n");
    const beforeExistingStart = bootoutCount();
    await assert.rejects(runAction("start", options), /launchd service .* already loaded/);
    assert.equal(fsExists(fixture.statePath), true);
    assert.equal(bootoutCount(), beforeExistingStart);
    rmSync(fixture.statePath, { force: true });

    writeFileSync(fixture.failPath, "fixture\n");
    writeFileSync(fixture.cleanupFailPath, "fixture\n");
    await assert.rejects(runAction("start", options), /launchctl bootstrap .*fixture bootstrap failed;.*cleanup could not be verified/);
    assert.equal(fsExists(fixture.statePath), true);
    const identity = resolveTargetIdentity(validateConfig({}), fixture.env);
    assert.equal(fsExists(targetRecordPath(fixture.stateDir, identity.identity)), true);
    rmSync(fixture.cleanupFailPath, { force: true });
    rmSync(fixture.failPath, { force: true });
    await runAction("stop", options);
    assert.equal(fsExists(fixture.statePath), false);
  } finally {
    if (fsExists(fixture.statePath)) {
      const pid = Number(readFileSync(fixture.statePath, "utf8"));
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    await new Promise((resolve) => fixture.socketServer.close(resolve));
    rmSync(fixture.socketPath, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("start recovers an owned launchd service when its runtime record is missing", async () => {
  const fixture = await launchdFixture();
  const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: "arm64" };
  const identity = resolveTargetIdentity(validateConfig({}), fixture.env);
  const recordPath = targetRecordPath(fixture.stateDir, identity.identity);
  try {
    await runAction("start", options);
    rmSync(recordPath, { force: true });

    const configPath = path.join(fixture.env.HERDR_PLUGIN_CONFIG_DIR, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        host: "0.0.0.0",
        port: fixture.port,
        port_range: [fixture.port, fixture.port],
        allowed_hosts: ["world.example"],
        allowed_origins: ["https://world.example"],
      }),
    );
    await runAction("start", options);

    const commands = readFileSync(fixture.logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(commands.some((args) => args[0] === "bootout"));
    assert.ok(commands.some((args) => args[0] === "bootstrap"));
    const plistName = readdirSync(path.join(fixture.stateDir, "supervisors")).find((name) => name.endsWith(".plist"));
    assert.ok(plistName);
    const serviceDefinition = readFileSync(path.join(fixture.stateDir, "supervisors", plistName), "utf8");
    assert.match(serviceDefinition, /<string>0\.0\.0\.0<\/string>/);
  } finally {
    try { await runAction("stop", options); } catch {}
    await new Promise((resolve) => fixture.socketServer.close(resolve));
    rmSync(fixture.socketPath, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("remote access apply waits for readiness and restores the prior service on failure", async () => {
  const fixture = await launchdFixture();
  mkdirSync(path.join(fixture.root, "scripts"), { recursive: true });
  writeFileSync(
    path.join(fixture.root, "scripts", "herdr-world-plugin.mjs"),
    readFileSync(path.join(ROOT, "scripts", "herdr-world-plugin.mjs")),
  );
  const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: "arm64" };
  const configPath = path.join(fixture.env.HERDR_PLUGIN_CONFIG_DIR, "config.json");
  const statusPath = path.join(fixture.stateDir, "remote-access-apply.json");
  const draftPath = path.join(fixture.stateDir, "remote-access-request.json");
  try {
    await runAction("start", options);
    const identity = resolveTargetIdentity(validateConfig({}), fixture.env);
    rmSync(targetRecordPath(fixture.stateDir, identity.identity), { force: true });
    writeFileSync(draftPath, JSON.stringify({
      remote_access: {
        enabled: true,
        accepted_hosts: ["bridge.example.test"],
        allowed_page_origins: ["http://world.example.test"],
        allowed_bridge_origins: [],
      },
    }));
    fixture.env.HERDR_WORLD_APPLY_GRACE_MS = "100";
    const applying = applyRemoteAccessAction({ draftPath, ...options });
    for (let attempt = 0; attempt < 20 && !fsExists(statusPath); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(JSON.parse(readFileSync(statusPath, "utf8")).state, "applying");
    await applying;
    const appliedConfig = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(appliedConfig.remote_access.enabled, true);
    assert.deepEqual(appliedConfig.allowed_hosts, ["bridge.example.test"]);
    assert.equal(JSON.parse(readFileSync(statusPath, "utf8")).state, "ready");
    assert.equal(fsExists(fixture.statePath), true);
    assert.ok(readFileSync(fixture.logPath, "utf8").includes('"bootout"'));

    const previousText = readFileSync(configPath, "utf8");
    writeFileSync(draftPath, JSON.stringify({
      remote_access: {
        enabled: false,
        accepted_hosts: ["bridge.example.test"],
        allowed_page_origins: ["http://world.example.test"],
        allowed_bridge_origins: [],
      },
    }));
    writeFileSync(fixture.failPath, "fail once\n");
    await assert.rejects(
      applyRemoteAccessAction({ draftPath, ...options }),
      /fixture bootstrap failed/,
    );
    assert.equal(readFileSync(configPath, "utf8"), previousText);
    const applyStatus = JSON.parse(readFileSync(statusPath, "utf8"));
    assert.equal(applyStatus.state, "failed");
    assert.equal(applyStatus.restored, true);
    assert.equal(fsExists(fixture.statePath), true);
  } finally {
    try { await runAction("stop", options); } catch {}
    await new Promise((resolve) => fixture.socketServer.close(resolve));
    rmSync(fixture.socketPath, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("consecutive remote access applies preserve an automatically allocated target port", async () => {
  const fixture = await launchdFixture();
  mkdirSync(path.join(fixture.root, "scripts"), { recursive: true });
  writeFileSync(
    path.join(fixture.root, "scripts", "herdr-world-plugin.mjs"),
    readFileSync(path.join(ROOT, "scripts", "herdr-world-plugin.mjs")),
  );
  const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: "arm64" };
  const configPath = path.join(fixture.env.HERDR_PLUGIN_CONFIG_DIR, "config.json");
  const allocatedPort = fixture.port === 8787 ? await freePort() : fixture.port;
  const selectedIdentity = resolveTargetIdentity(validateConfig({}), fixture.env).identity;
  const otherRecordPath = targetRecordPath(fixture.stateDir, "other-target");
  writeFileSync(configPath, JSON.stringify({ port_range: [allocatedPort, allocatedPort] }));
  mkdirSync(path.dirname(otherRecordPath), { recursive: true });
  writeFileSync(otherRecordPath, JSON.stringify({ target_identity: "other-target", port: 8787 }));

  try {
    const started = await runAction("start", options);
    assert.equal(started.port, allocatedPort);
    assert.notEqual(started.port, 8787);

    for (const [index, enabled] of [true, false].entries()) {
      const draftPath = path.join(fixture.stateDir, `remote-access-${index}.json`);
      writeFileSync(draftPath, JSON.stringify({
        apply_id: `apply-${index}`,
        remote_access: {
          enabled,
          accepted_hosts: enabled ? ["bridge.example.test"] : [],
          allowed_page_origins: enabled ? ["http://world.example.test"] : [],
          allowed_bridge_origins: [],
        },
      }));
      await applyRemoteAccessAction({ draftPath, ...options });

      const record = JSON.parse(readFileSync(
        targetRecordPath(fixture.stateDir, selectedIdentity),
        "utf8",
      ));
      assert.equal(record.port, allocatedPort);
      const persisted = JSON.parse(readFileSync(configPath, "utf8"));
      assert.equal(Object.hasOwn(persisted, "port"), false);
      assert.equal(Object.hasOwn(persisted, "port_was_explicit"), false);
      assert.equal(JSON.parse(
        readFileSync(path.join(fixture.stateDir, "remote-access-apply.json"), "utf8"),
      ).id, `apply-${index}`);
    }

    const previousText = readFileSync(configPath, "utf8");
    const failingDraft = path.join(fixture.stateDir, "remote-access-failing.json");
    writeFileSync(failingDraft, JSON.stringify({
      apply_id: "apply-failing",
      remote_access: {
        enabled: true,
        accepted_hosts: ["bridge.example.test"],
        allowed_page_origins: ["http://world.example.test"],
        allowed_bridge_origins: [],
      },
    }));
    writeFileSync(fixture.failPath, "fail once\n");
    await assert.rejects(
      applyRemoteAccessAction({ draftPath: failingDraft, ...options }),
      /fixture bootstrap failed/,
    );
    assert.equal(readFileSync(configPath, "utf8"), previousText);
    assert.equal(JSON.parse(readFileSync(
      targetRecordPath(fixture.stateDir, selectedIdentity),
      "utf8",
    )).port, allocatedPort);
  } finally {
    try { await runAction("stop", options); } catch {}
    await new Promise((resolve) => fixture.socketServer.close(resolve));
    rmSync(fixture.socketPath, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fallback remote access apply recovers an owned service when its runtime record is missing", async () => {
  const fixture = await launchdFixture();
  const unavailableLaunchctl = path.join(fixture.root, "bin", "unavailable-launchctl");
  executableScript(unavailableLaunchctl, "#!/bin/sh\nexit 1\n");
  mkdirSync(path.join(fixture.root, "scripts"), { recursive: true });
  writeFileSync(
    path.join(fixture.root, "scripts", "herdr-world-plugin.mjs"),
    readFileSync(path.join(ROOT, "scripts", "herdr-world-plugin.mjs")),
  );
  fixture.env.HERDR_WORLD_LAUNCHCTL = unavailableLaunchctl;
  const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: "arm64" };
  const configPath = path.join(fixture.env.HERDR_PLUGIN_CONFIG_DIR, "config.json");
  const statusPath = path.join(fixture.stateDir, "remote-access-apply.json");
  const draftPath = path.join(fixture.stateDir, "remote-access-request.json");
  try {
    await runAction("start", options);
    const identity = resolveTargetIdentity(validateConfig({}), fixture.env);
    rmSync(targetRecordPath(fixture.stateDir, identity.identity), { force: true });
    writeFileSync(draftPath, JSON.stringify({
      remote_access: {
        enabled: true,
        accepted_hosts: ["bridge.example.test"],
        allowed_page_origins: ["http://world.example.test"],
        allowed_bridge_origins: [],
      },
    }));
    await applyRemoteAccessAction({ draftPath, ...options });
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).remote_access.enabled, true);
    assert.equal(JSON.parse(readFileSync(statusPath, "utf8")).state, "ready");
    assert.equal(fsExists(fixture.statePath), false);
  } finally {
    try { await runAction("stop", options); } catch {}
    await new Promise((resolve) => fixture.socketServer.close(resolve));
    rmSync(fixture.socketPath, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("concurrent remote access applies roll back to the locked successful baseline", async () => {
  const fixture = await launchdFixture();
  mkdirSync(path.join(fixture.root, "scripts"), { recursive: true });
  writeFileSync(
    path.join(fixture.root, "scripts", "herdr-world-plugin.mjs"),
    readFileSync(path.join(ROOT, "scripts", "herdr-world-plugin.mjs")),
  );
  const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: "arm64" };
  const configPath = path.join(fixture.env.HERDR_PLUGIN_CONFIG_DIR, "config.json");
  const firstDraft = path.join(fixture.stateDir, "remote-access-first.json");
  const secondDraft = path.join(fixture.stateDir, "remote-access-second.json");
  try {
    await runAction("start", options);
    fixture.env.HERDR_WORLD_APPLY_GRACE_MS = "200";
    writeFileSync(firstDraft, JSON.stringify({
      remote_access: {
        enabled: true,
        accepted_hosts: ["first.example.test"],
        allowed_page_origins: ["http://world.example.test"],
        allowed_bridge_origins: [],
      },
    }));
    writeFileSync(secondDraft, JSON.stringify({
      remote_access: {
        enabled: true,
        accepted_hosts: ["second.example.test"],
        allowed_page_origins: ["http://world.example.test"],
        allowed_bridge_origins: [],
      },
    }));

    const firstApply = applyRemoteAccessAction({ draftPath: firstDraft, ...options });
    const secondApply = applyRemoteAccessAction({ draftPath: secondDraft, ...options });
    await firstApply;
    writeFileSync(fixture.failPath, "fail after first apply\n");
    await assert.rejects(secondApply, /fixture bootstrap failed/);

    const restored = JSON.parse(readFileSync(configPath, "utf8"));
    assert.deepEqual(restored.allowed_hosts, ["first.example.test"]);
    assert.equal(fsExists(fixture.statePath), true);
  } finally {
    try { await runAction("stop", options); } catch {}
    await new Promise((resolve) => fixture.socketServer.close(resolve));
    rmSync(fixture.socketPath, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

if (process.env.HERDR_WORLD_REAL_LAUNCHD === "1") {
  test("real macOS launchd starts, restarts, and stops the plugin service", { timeout: 30_000 }, async () => {
    assert.equal(process.platform, "darwin");
    const fixture = await launchdFixture({ real: true });
    const options = { root: fixture.root, env: fixture.env, platform: "darwin", arch: process.arch };
    const identity = resolveTargetIdentity(validateConfig({}), fixture.env);
    const label = serviceName(identity.identity, "launchd");
    const serviceTarget = `gui/${process.getuid()}/${label}`;
    try {
      const first = await runAction("start", options);
      assert.equal(first.supervisor, "launchd");
      assert.equal(first.port, fixture.port);

      const repeated = await runAction("start", options);
      assert.equal(repeated.service_name, first.service_name);

      const restarted = await runAction("restart", options);
      assert.equal(restarted.supervisor, "launchd");
      assert.equal(restarted.port, fixture.port);

      await runAction("stop", options);
      assert.equal(await runAction("status", options), null);
    } finally {
      try { await runAction("stop", options); } catch {}
      spawnSync("/bin/launchctl", ["bootout", serviceTarget], { stdio: "ignore", timeout: 5_000 });
      await new Promise((resolve) => fixture.socketServer.close(resolve));
      rmSync(fixture.socketPath, { force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("release workflow gates publication on the three-platform unpublished plugin smoke", () => {
  const workflow = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const packageJob = workflow.indexOf("  npm_package:");
  const githubJob = workflow.indexOf("  github_release:");
  const pluginJob = workflow.indexOf("  plugin_smoke:");
  assert.ok(packageJob >= 0 && githubJob >= 0 && pluginJob >= 0);
  const pluginSection = workflow.slice(pluginJob, workflow.indexOf("  homebrew_publish:", pluginJob));
  const githubSection = workflow.slice(githubJob, workflow.indexOf("  homebrew_test:", githubJob));
  assert.match(pluginSection, /needs: \[npm_package\]/);
  assert.match(pluginSection, /PLUGIN_CHECKOUT:/);
  assert.match(pluginSection, /PLUGIN_PACKAGE:/);
  assert.match(pluginSection, /live-plugin-smoke\.sh/);
  assert.match(githubSection, /needs: \[[^\]]*plugin_smoke[^\]]*homebrew_test[^\]]*\]/);
  assert.equal((workflow.match(/platform: linux-x86_64/g) ?? []).length >= 2, true);
  assert.match(workflow.slice(pluginJob), /platform: macos-arm64/);
  assert.match(workflow.slice(pluginJob), /platform: macos-x86_64/);
  assert.match(workflow, /package_path="\$\{GITHUB_WORKSPACE\}\/npm-output\/herdr-world-\$\{VERSION\}\.tgz"/);
});

test("release workflow retries only the known Linux Homebrew SIGPIPE audit failure", () => {
  const workflow = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const homebrewJob = workflow.indexOf("  homebrew_test:");
  const npmPublishJob = workflow.indexOf("  npm_publish:", homebrewJob);
  assert.ok(homebrewJob >= 0 && npmPublishJob > homebrewJob);
  const homebrewSection = workflow.slice(homebrewJob, npmPublishJob);
  assert.match(homebrewSection, /if \[\[ "\$\(uname -s\)" != "Linux" \]\]; then/);
  assert.match(homebrewSection, /for attempt in 1 2 3; do/);
  assert.match(homebrewSection, /grep -Fq "Broken pipe" "\$audit_log"/);
  assert.match(homebrewSection, /run_brew_audit "\$\{audit_args\[@\]\}" "\$qualified_formula"/);
});

test("release workflow trusts the published peer Formula before conflict validation", () => {
  const workflow = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const homebrewJob = workflow.indexOf("  homebrew_test:");
  const npmPublishJob = workflow.indexOf("  npm_publish:", homebrewJob);
  assert.ok(homebrewJob >= 0 && npmPublishJob > homebrewJob);
  const homebrewSection = workflow.slice(homebrewJob, npmPublishJob);
  assert.match(
    homebrewSection,
    /if \[\[ -f "\$tap_root\/Formula\/\$\{other_formula\}\.rb" \]\]; then\s+# Homebrew requires explicit trust[\s\S]*brew trust --formula "\$tap_name\/\$other_formula"/,
  );
  assert.ok(
    homebrewSection.indexOf('brew trust --formula "$tap_name/$other_formula"') <
      homebrewSection.indexOf('run_brew_audit "${audit_args[@]}" "$qualified_formula"'),
  );
});

test("PR CI exercises real launchd on both macOS architectures", () => {
  const workflow = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /HERDR_WORLD_REAL_LAUNCHD: "1"/);
  assert.match(workflow, /node --test scripts\/herdr-world-plugin\.test\.mjs/);
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
  assert.match(smoke, /wait_for_startup/);
  assert.match(smoke, /mktemp -d \/tmp\/hwp\.XXXXXX/);
  assert.match(smoke, /HERDR_WORLD_PLUGIN_PACKAGE="\$PLUGIN_PACKAGE"/);
  assert.match(smoke, /plugin link "\$PLUGIN_CHECKOUT" --enabled/);
  assert.ok(smoke.indexOf('plugin install IvoryHeart/herdr-world') < smoke.indexOf('echo "Starting stock Herdr release smoke daemon and restoring the plugin service"'));
  assert.ok(smoke.indexOf("wait_for_startup") < smoke.indexOf("wait_for_bridge http://127.0.0.1:8787"));
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
