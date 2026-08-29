#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PLUGIN_ID = "ivoryheart.herdr-world";
export const PACKAGE_NAME = "@ivoryheart/herdr-world";
export const MIN_NODE_VERSION = "22.14.0";
export const MIN_HERDR_VERSION = "0.8.2";
export const TERMINAL_PROTOCOL = 20;
export const BRIDGE_API_VERSION = 1;
export const WEB_COMPAT_VERSION = 1;
export const DEFAULT_PORT = 8787;
export const DEFAULT_PORT_RANGE = [8787, 8877];
export const CONFIG_FILE = "config.json";
export const SERVICE_SCHEMA_VERSION = 1;
export const ACTIONS = ["build", "start", "stop", "restart", "status", "open", "doctor"];
export const STARTUP_COMMAND = "startup";
export const SUPPORTED_TARGETS = {
  "linux-x64": "linux-x64",
  "darwin-arm64": "macos-arm64",
  "darwin-x64": "macos-x64",
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org/";
const RUNTIME_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 10_000;

export class PluginError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "PluginError";
  }
}

function fail(message) {
  throw new PluginError(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  const match = normalized.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4]),
    value: normalized,
  };
}

export function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) throw new PluginError(`invalid version comparison: ${left} and ${right}`);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.rc === b.rc) return 0;
  if (a.rc === null) return 1;
  if (b.rc === null) return -1;
  return a.rc > b.rc ? 1 : -1;
}

export function minimumVersionSatisfied(value, minimum) {
  const parsed = parseVersion(value);
  const required = parseVersion(minimum);
  return Boolean(parsed && required && compareVersions(parsed, required) >= 0);
}

function parseTomlValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return [...trimmed.matchAll(/"(?:\\.|[^"\\])*"/g)].map((match) => JSON.parse(match[0]));
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  return null;
}

export function parsePluginManifest(text) {
  if (typeof text !== "string") throw new PluginError("plugin manifest must be text");
  const top = {};
  const blocks = [];
  let block = null;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const section = line.match(/^\[\[([^\]]+)\]\]$/);
    if (section) {
      block = { type: section[1], line: index + 1 };
      blocks.push(block);
      continue;
    }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!assignment) throw new PluginError(`invalid plugin manifest line ${index + 1}`);
    const [, key, rawValue] = assignment;
    const value = parseTomlValue(rawValue);
    if (value === null) throw new PluginError(`unsupported plugin manifest value for ${key} on line ${index + 1}`);
    if (block) block[key] = value;
    else top[key] = value;
  }
  return { ...top, blocks };
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validatePluginManifest(manifest) {
  const errors = [];
  if (!isObject(manifest)) return ["manifest is not an object"];
  if (manifest.id !== PLUGIN_ID) errors.push(`id must be ${PLUGIN_ID}`);
  if (manifest.name !== "Herdr World") errors.push("name must be Herdr World");
  if (!parseVersion(manifest.version) || manifest.version.startsWith("v")) {
    errors.push("version must be an unprefixed release version");
  }
  if (manifest.min_herdr_version !== MIN_HERDR_VERSION) {
    errors.push(`min_herdr_version must be ${MIN_HERDR_VERSION}`);
  }
  if (!arraysEqual(manifest.platforms, ["linux", "macos"])) {
    errors.push('platforms must be ["linux", "macos"]');
  }
  const build = manifest.blocks?.filter((entry) => entry.type === "build") ?? [];
  if (build.length !== 1 || !arraysEqual(build[0]?.command, ["bash", "scripts/herdr-world-plugin.sh", "build"])) {
    errors.push("manifest must declare the exact plugin build command");
  }
  const startup = manifest.blocks?.filter((entry) => entry.type === "startup") ?? [];
  if (startup.length !== 1 || !arraysEqual(startup[0]?.command, ["bash", "scripts/herdr-world-plugin.sh", STARTUP_COMMAND])) {
    errors.push("manifest must declare the exact startup hook command");
  }
  for (const forbidden of ["events", "panes", "link_handlers"]) {
    if (manifest.blocks?.some((entry) => entry.type === forbidden)) {
      errors.push(`manifest must not declare [[${forbidden}]]`);
    }
  }
  const actions = manifest.blocks?.filter((entry) => entry.type === "actions") ?? [];
  if (actions.length !== 6) errors.push("manifest must declare exactly six actions");
  const actionIds = actions.map((entry) => entry.id);
  if (!arraysEqual([...actionIds].sort(), ["doctor", "open", "restart", "start", "status", "stop"])) {
    errors.push("manifest action ids must be start, stop, restart, status, open, and doctor");
  }
  for (const action of actions) {
    if (!ACTIONS.includes(action.id) || action.id === "build") continue;
    if (!arraysEqual(action.contexts, ["workspace"])) {
      errors.push(`${action.id} must be workspace-scoped`);
    }
    if (!arraysEqual(action.command, ["bash", "scripts/herdr-world-plugin.sh", action.id])) {
      errors.push(`${action.id} must invoke the controller by path`);
    }
  }
  return errors;
}

export function assertPluginManifest(manifest) {
  const errors = validatePluginManifest(manifest);
  if (errors.length > 0) throw new PluginError(`invalid herdr-plugin.toml: ${errors.join("; ")}`);
  return manifest;
}

export function readPluginManifest(root = ROOT) {
  const manifestPath = path.join(root, "herdr-plugin.toml");
  try {
    return assertPluginManifest(parsePluginManifest(readFileSync(manifestPath, "utf8")));
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError(`could not read ${manifestPath}: ${error.message}`);
  }
}

function executable(pathname) {
  try {
    accessSync(pathname, os.platform() === "win32" ? 0 : 1);
    return true;
  } catch {
    return false;
  }
}

export function resolveExecutable(command, { env = process.env, explicitPath } = {}) {
  const candidate = explicitPath ?? (path.isAbsolute(command) ? command : null);
  if (candidate) {
    if (!path.isAbsolute(candidate) || !executable(candidate)) {
      throw new PluginError(`required executable is not available: ${candidate}`);
    }
    return path.resolve(candidate);
  }
  const pathEntries = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const pathname = path.join(entry, command);
    if (executable(pathname)) return path.resolve(pathname);
  }
  throw new PluginError(`required executable is not available on PATH: ${command}`);
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? RUNTIME_TIMEOUT_MS,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function commandOutput(command, args, options = {}) {
  const result = commandResult(command, args, options);
  if (result.error) throw new PluginError(`${path.basename(command)} ${args.join(" ")} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || `exit status ${result.status}`).trim();
    throw new PluginError(`${path.basename(command)} ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout ?? "").trim();
}

function toolVersion(command, args = ["--version"], options = {}) {
  const output = commandOutput(command, args, options);
  const match = output.match(/v?(\d+\.\d+\.\d+)/);
  if (!match || !parseVersion(match[1])) throw new PluginError(`could not determine ${path.basename(command)} version`);
  return match[1];
}

export function resolveNode({ env = process.env, nodePath } = {}) {
  return resolveExecutable("node", { env, explicitPath: nodePath ?? env.HERDR_WORLD_NODE_PATH });
}

export function checkNode(nodePath, { runner = commandOutput } = {}) {
  let version;
  try {
    version = runner(nodePath, ["--version"], { timeout: RUNTIME_TIMEOUT_MS });
  } catch (error) {
    throw new PluginError(`Node.js could not be executed at ${nodePath}: ${error.message}`);
  }
  const match = String(version).match(/v?(\d+\.\d+\.\d+)/);
  if (!match || !minimumVersionSatisfied(match[1], MIN_NODE_VERSION)) {
    throw new PluginError(`Node.js ${MIN_NODE_VERSION} or newer is required; found ${String(version).trim() || "unknown"}`);
  }
  return { path: path.resolve(nodePath), version: match[1] };
}

export function selectTarget({ platform = process.platform, arch = process.arch, glibcVersion } = {}) {
  const key = `${platform}-${arch}`;
  const target = SUPPORTED_TARGETS[key];
  if (!target) throw new PluginError(`unsupported Herdr World plugin target: ${key}`);
  if (platform === "linux") {
    const detected = glibcVersion ?? process.report?.getReport?.().header?.glibcVersionRuntime;
    if (typeof detected !== "string" || !/^\d+\.\d+$/.test(detected)) {
      throw new PluginError("Linux musl or unknown libc is unsupported; a detectable glibc 2.34 or newer is required");
    }
    const [major, minor] = detected.split(".").map(Number);
    if (major < 2 || (major === 2 && minor < 34)) {
      throw new PluginError(`Linux glibc 2.34 or newer is required; found ${detected}`);
    }
  }
  return { key, target };
}

function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Windows has no equivalent user-only directory mode.
  }
  return directory;
}

function ensureRuntimeDirectories(env) {
  const configDir = env.HERDR_PLUGIN_CONFIG_DIR;
  const stateDir = env.HERDR_PLUGIN_STATE_DIR;
  if (!configDir || !stateDir) {
    throw new PluginError("Herdr plugin config/state directories are unavailable; invoke this action through Herdr");
  }
  if (!path.isAbsolute(configDir) || !path.isAbsolute(stateDir)) {
    throw new PluginError("Herdr plugin config/state directories must be absolute paths");
  }
  ensureDirectory(configDir);
  ensureDirectory(stateDir);
  ensureDirectory(path.join(stateDir, "runtimes"));
  ensureDirectory(path.join(stateDir, "logs"));
  ensureDirectory(path.join(stateDir, "supervisors"));
  return { configDir, stateDir };
}

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: DEFAULT_PORT,
  port_range: DEFAULT_PORT_RANGE,
  session_name: null,
  socket_path: null,
  upload_dir: null,
  allowed_hosts: [],
  allowed_origins: [],
  allowed_connect_origins: [],
  bridge_label: null,
};

function validHost(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 253 || /[\s\0\r\n]/.test(value)) return false;
  if (net.isIP(value)) return true;
  return !value.includes("/") && !value.includes("\\") &&
    /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(value);
}

function validSession(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function validOrigin(value) {
  if (typeof value !== "string" || value.includes("*") || /[\r\n]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" && parsed.password === "" && parsed.pathname === "/" &&
      parsed.search === "" && parsed.hash === "" && parsed.hostname !== "" &&
      parsed.origin === value;
  } catch {
    return false;
  }
}

function validStringArray(value, validator, label) {
  if (!Array.isArray(value) || value.length > 32 || value.some((item) => !validator(item))) {
    throw new PluginError(`${label} must be an array of valid values`);
  }
  return [...new Set(value)];
}

export function validateConfig(input) {
  if (!isObject(input)) throw new PluginError("plugin config must be a JSON object");
  const config = { ...DEFAULT_CONFIG, ...input };
  config.port_was_explicit = input.port_was_explicit === true;
  if (!validHost(config.host)) throw new PluginError("config host must be a non-empty hostname or IP literal");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new PluginError("config port must be an integer between 1 and 65535");
  }
  if (!Array.isArray(config.port_range) || config.port_range.length !== 2 ||
      config.port_range.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) ||
      config.port_range[0] > config.port_range[1]) {
    throw new PluginError("config port_range must contain two ordered ports between 1 and 65535");
  }
  if (config.session_name !== null && !validSession(config.session_name)) {
    throw new PluginError("config session_name must contain only ASCII letters, digits, '.', '_', or '-'");
  }
  if (config.socket_path !== null && (!path.isAbsolute(String(config.socket_path)) || /[\0\r\n]/.test(config.socket_path))) {
    throw new PluginError("config socket_path must be an absolute path");
  }
  if (config.session_name !== null && config.socket_path !== null) {
    throw new PluginError("config session_name and socket_path are mutually exclusive");
  }
  if (config.upload_dir !== null && (!path.isAbsolute(String(config.upload_dir)) || /[\0\r\n]/.test(config.upload_dir))) {
    throw new PluginError("config upload_dir must be an absolute path");
  }
  if (config.bridge_label !== null && (typeof config.bridge_label !== "string" || config.bridge_label.length === 0 || config.bridge_label.length > 80 || /[\0\r\n]/.test(config.bridge_label))) {
    throw new PluginError("config bridge_label must be 1-80 characters without control characters");
  }
  config.allowed_hosts = validStringArray(config.allowed_hosts, validHost, "config allowed_hosts");
  config.allowed_origins = validStringArray(config.allowed_origins, validOrigin, "config allowed_origins");
  config.allowed_connect_origins = validStringArray(config.allowed_connect_origins, validOrigin, "config allowed_connect_origins");
  if (!isLoopbackHost(config.host) && (config.allowed_hosts.length === 0 || config.allowed_origins.length === 0)) {
    throw new PluginError("non-loopback binding requires explicit allowed_hosts and allowed_origins configuration");
  }
  return config;
}

export function loadConfig(configDir) {
  const configPath = path.join(configDir, CONFIG_FILE);
  if (!existsSync(configPath)) return validateConfig({ ...DEFAULT_CONFIG, port_was_explicit: false });
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new PluginError(`could not parse ${configPath}: ${error.message}`);
  }
  return validateConfig({ ...parsed, port_was_explicit: Object.hasOwn(parsed, "port") });
}

function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function absolutePath(value) {
  return path.resolve(value);
}

export function resolveTargetIdentity(config, env) {
  if (config.session_name !== null) {
    const key = `session:${config.session_name}`;
    return {
      key,
      identity: `session:${hash(key).slice(0, 32)}`,
      session_name: config.session_name,
      socket_path: null,
    };
  }
  const selected = config.socket_path ?? env.HERDR_SOCKET_PATH;
  if (!selected) throw new PluginError("no Herdr target is selected; start Herdr or configure socket_path/session_name");
  if (!path.isAbsolute(selected)) throw new PluginError("selected HERDR_SOCKET_PATH must be absolute");
  const socketPath = absolutePath(selected);
  const key = `socket:${socketPath}`;
  return {
    key,
    identity: `socket:${hash(key).slice(0, 32)}`,
    session_name: null,
    socket_path: socketPath,
  };
}

export function targetRecordPath(stateDir, identity) {
  return path.join(stateDir, "runtimes", `${hash(identity).slice(0, 32)}.json`);
}

export function serviceName(identity, supervisor) {
  const suffix = hash(identity).slice(0, 24);
  return supervisor === "launchd" ? `io.ivoryheart.herdr-world.${suffix}` : `herdr-world-${suffix}.service`;
}

export function npmInstallArgs(version, prefix = ".herdr-world-plugin") {
  return [
    "install",
    `--registry=${REGISTRY}`,
    `--@ivoryheart:registry=${REGISTRY}`,
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    `${PACKAGE_NAME}@${version}`,
  ];
}

export function npmInstallCommand(version) {
  return ["npm", ...npmInstallArgs(version)].join(" ");
}

function payloadPaths(root, version, target) {
  const prefix = path.join(root, ".herdr-world-plugin");
  const packageRoot = path.join(prefix, "node_modules", "@ivoryheart", "herdr-world");
  return {
    prefix,
    packageRoot,
    packageJson: path.join(packageRoot, "package.json"),
    entrypoint: path.join(prefix, "node_modules", ".bin", "herdr-world"),
    bridge: path.join(packageRoot, "lib", "bridges", target, "herdr-world-bridge"),
    staticIndex: path.join(packageRoot, "share", "herdr-world", "web", "index.html"),
    legalManifest: path.join(packageRoot, "share", "herdr-world", "web", "legal", "manifest.json"),
    launcher: path.join(packageRoot, "lib", "herdr-world-launcher.sh"),
  };
}

export function validatePayload(root, version, target) {
  const paths = payloadPaths(root, version, target);
  let packageJson;
  let legalManifest;
  try {
    packageJson = JSON.parse(readFileSync(paths.packageJson, "utf8"));
  } catch (error) {
    throw new PluginError(`private npm payload is incomplete: could not read ${paths.packageJson}: ${error.message}`);
  }
  if (packageJson.name !== PACKAGE_NAME || packageJson.version !== version) {
    throw new PluginError(`private npm payload version mismatch: expected ${PACKAGE_NAME}@${version}`);
  }
  try {
    legalManifest = JSON.parse(readFileSync(paths.legalManifest, "utf8"));
  } catch (error) {
    throw new PluginError(`private npm payload has an invalid legal manifest: ${error.message}`);
  }
  if (legalManifest.schema_version !== 1 || !Array.isArray(legalManifest.files)) {
    throw new PluginError("private npm payload has an invalid legal manifest schema");
  }
  const required = [
    [paths.entrypoint, "private npm herdr-world entrypoint"],
    [paths.bridge, `${target} native bridge`],
    [paths.staticIndex, "packaged web assets"],
    [paths.legalManifest, "packaged legal manifest"],
    [paths.launcher, "packaged launcher"],
    [path.join(paths.packageRoot, "LICENSE"), "package license"],
    [path.join(paths.packageRoot, "THIRD_PARTY_NOTICES.md"), "third-party notices"],
    [path.join(paths.packageRoot, "UPSTREAM.md"), "upstream record"],
  ];
  for (const [pathname, label] of required) {
    if (!existsSync(pathname)) throw new PluginError(`private npm payload is missing ${label}: ${pathname}`);
  }
  if (!executable(paths.entrypoint) || !executable(paths.bridge) || !executable(paths.launcher)) {
    throw new PluginError("private npm payload contains a non-executable launcher or native bridge");
  }
  const legalRoot = path.dirname(paths.legalManifest);
  for (const entry of legalManifest.files) {
    if (!isObject(entry) || typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("..")) {
      throw new PluginError("private npm payload legal manifest contains an unsafe path");
    }
    const legalPath = path.resolve(legalRoot, entry.path);
    if (path.relative(legalRoot, legalPath).startsWith(`..${path.sep}`) || !existsSync(legalPath)) {
      throw new PluginError(`private npm payload is missing a legal file: ${entry.path}`);
    }
  }
  return { ...paths, packageJson, legalManifest };
}

export function requirePayload(root, version, target) {
  try {
    return validatePayload(root, version, target);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PluginError(`${detail}\nInstall the exact private payload with:\n  ${npmInstallCommand(version)}`);
  }
}

function readManifestVersion(root) {
  return readPluginManifest(root).version;
}

export function buildPayload({ root = ROOT, env = process.env, nodePath, npmPath, platform = process.platform, arch = process.arch, glibcVersion } = {}) {
  const manifest = readPluginManifest(root);
  const target = selectTarget({ platform, arch, glibcVersion });
  const node = checkNode(resolveNode({ env, nodePath }));
  const npm = resolveExecutable("npm", { env, explicitPath: npmPath ?? env.HERDR_WORLD_NPM_PATH });
  try {
    toolVersion(npm, ["--version"]);
  } catch (error) {
    throw new PluginError(`npm is unavailable: ${error.message}`);
  }
  const prefix = path.join(root, ".herdr-world-plugin");
  rmSync(prefix, { recursive: true, force: true });
  ensureDirectory(prefix);
  try {
    const result = spawnSync(npm, npmInstallArgs(manifest.version, prefix), {
      cwd: root,
      env: { ...env },
      stdio: "inherit",
      timeout: 20 * 60 * 1000,
    });
    if (result.error) throw new PluginError(`npm payload installation failed: ${result.error.message}`);
    if (result.status !== 0) throw new PluginError(`npm payload installation failed with exit status ${result.status}`);
    const payload = validatePayload(root, manifest.version, target.target);
    console.log(`Installed ${PACKAGE_NAME}@${manifest.version} for ${target.target}`);
    console.log(`  payload: ${payload.packageRoot}`);
    console.log(`  Node.js: ${node.version} (${node.path})`);
    return payload;
  } catch (error) {
    rmSync(prefix, { recursive: true, force: true });
    if (error instanceof PluginError) throw error;
    throw new PluginError(`npm payload installation failed: ${error.message}`);
  }
}

function runtimeContext(env) {
  const directories = ensureRuntimeDirectories(env);
  const config = loadConfig(directories.configDir);
  const target = resolveTargetIdentity(config, env);
  return { ...directories, config, target };
}

function herdrBinary(env) {
  const value = env.HERDR_BIN_PATH;
  if (!value || !path.isAbsolute(value) || !executable(value)) {
    throw new PluginError("HERDR_BIN_PATH is missing or is not an executable absolute path; run the action from Herdr");
  }
  return path.resolve(value);
}

function statusJson(herdr, args, env) {
  const result = commandResult(herdr, args, {
    env,
    timeout: RUNTIME_TIMEOUT_MS,
  });
  if (result.error) throw new PluginError(`could not query the selected Herdr target: ${result.error.message}`);
  if (result.status !== 0) {
    throw new PluginError("could not query the selected Herdr target; start Herdr or select a running session");
  }
  try {
    return JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    throw new PluginError("Herdr returned an invalid JSON status response");
  }
}

export function resolveHerdrTarget(config, env, { requireRunning = true } = {}) {
  const herdr = herdrBinary(env);
  const queryEnv = { ...env };
  delete queryEnv.HERDR_SESSION;
  const args = [];
  if (config.session_name !== null) {
    args.push("--session", config.session_name);
    delete queryEnv.HERDR_SOCKET_PATH;
  } else {
    queryEnv.HERDR_SOCKET_PATH = config.socket_path ?? env.HERDR_SOCKET_PATH;
  }
  args.push("status", "server", "--json");
  const status = statusJson(herdr, args, queryEnv);
  if (requireRunning && (status.running !== true || status.status !== "running")) {
    throw new PluginError("selected Herdr target is not running; start Herdr before starting Herdr World");
  }
  const socketPath = config.session_name !== null ? status.socket : queryEnv.HERDR_SOCKET_PATH;
  if (typeof socketPath !== "string" || !path.isAbsolute(socketPath)) {
    throw new PluginError("selected Herdr target did not report an absolute socket path");
  }
  if (requireRunning && status.compatible !== true) {
    throw new PluginError(`selected Herdr target is incompatible; Herdr ${MIN_HERDR_VERSION} or protocol ${TERMINAL_PROTOCOL} is required`);
  }
  if (requireRunning && !minimumVersionSatisfied(status.version, MIN_HERDR_VERSION)) {
    throw new PluginError(`selected Herdr target reports Herdr ${status.version ?? "unknown"}; ${MIN_HERDR_VERSION} or newer is required`);
  }
  if (requireRunning && status.protocol !== TERMINAL_PROTOCOL) {
    throw new PluginError(`selected Herdr target reports terminal protocol ${status.protocol ?? "unknown"}; expected ${TERMINAL_PROTOCOL}`);
  }
  if (requireRunning) {
    try {
      if (!statSync(socketPath).isSocket()) throw new Error("not a socket");
    } catch {
      throw new PluginError(`selected Herdr socket is unavailable: ${path.basename(socketPath)}`);
    }
  }
  return {
    ...status,
    herdr_path: herdr,
    socket_path: path.resolve(socketPath),
    session_name: config.session_name,
  };
}

function bridgeUrl(host, port) {
  const displayHost = net.isIP(host) === 6 ? `[${host}]` : host;
  return `http://${displayHost}:${port}`;
}

function probeHost(host) {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "::1";
  return host;
}

function probeUrl(host, port) {
  return bridgeUrl(probeHost(host), port);
}

function safeCapability(capabilities, expectedVersion) {
  if (!isObject(capabilities)) return "capabilities response is not an object";
  if (capabilities.bridge_api_version !== BRIDGE_API_VERSION) return `bridge API ${String(capabilities.bridge_api_version)} is incompatible; expected ${BRIDGE_API_VERSION}`;
  if (capabilities.terminal_protocol !== TERMINAL_PROTOCOL) return `terminal protocol ${String(capabilities.terminal_protocol)} is incompatible; expected ${TERMINAL_PROTOCOL}`;
  if (!minimumVersionSatisfied(capabilities.herdr_version, MIN_HERDR_VERSION)) return `Herdr ${String(capabilities.herdr_version)} is incompatible; expected ${MIN_HERDR_VERSION} or newer`;
  if (!Number.isInteger(capabilities.web_compat) || capabilities.web_compat < WEB_COMPAT_VERSION) return `bridge web compatibility ${String(capabilities.web_compat)} is incompatible; expected ${WEB_COMPAT_VERSION}`;
  if (expectedVersion && capabilities.bridge_version && !parseVersion(capabilities.bridge_version) && capabilities.bridge_version !== "0.0.0") return "bridge reported an invalid version";
  return null;
}

export async function probeCapabilities(url, { timeoutMs = 750, fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await fetchImpl(`${url}/api/capabilities`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      return { ok: false, error: `HTTP ${response.status}` };
    }
    let capabilities;
    try {
      capabilities = await response.json();
    } catch {
      return { ok: false, error: "invalid JSON capabilities response" };
    }
    return { ok: true, capabilities };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function waitForReadiness(url, expected, { timeoutMs = START_TIMEOUT_MS, fetchImpl } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    const result = await probeCapabilities(url, { fetchImpl });
    if (result.ok) {
      const compatibility = safeCapability(result.capabilities, expected.package_version);
      if (!compatibility) return result.capabilities;
      lastError = compatibility;
    } else {
      lastError = result.error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new PluginError(`bridge did not become ready at ${url} within ${timeoutMs}ms: ${lastError}`);
}

function atomicWrite(pathname, content) {
  const directory = path.dirname(pathname);
  ensureDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(pathname)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    try { chmodSync(temporary, 0o600); } catch {}
    renameSync(temporary, pathname);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function writeRecord(pathname, record) {
  atomicWrite(pathname, `${JSON.stringify(record, null, 2)}\n`);
}

function readRecord(pathname) {
  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new PluginError(`could not read service record ${path.basename(pathname)}: ${error.message}`);
  }
}

function listRecords(stateDir) {
  const directory = path.join(stateDir, "runtimes");
  ensureDirectory(directory);
  const records = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const pathname = path.join(directory, name);
    const record = readRecord(pathname);
    if (record) records.push({ path: pathname, record });
  }
  return records;
}

function removeRecord(pathname) {
  rmSync(pathname, { force: true });
}

function lockPath(stateDir, identity) {
  return path.join(stateDir, "runtimes", `.${hash(identity).slice(0, 32)}.lock`);
}

export async function withTargetLock(stateDir, identity, callback) {
  ensureDirectory(path.join(stateDir, "runtimes"));
  const pathname = lockPath(stateDir, identity);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let descriptor;
  while (Date.now() < deadline) {
    try {
      descriptor = openSync(pathname, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (descriptor === undefined) throw new PluginError("another Herdr World action is managing this target; retry shortly");
  try {
    return await callback();
  } finally {
    closeSync(descriptor);
    rmSync(pathname, { force: true });
  }
}

function portIsFree(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (free) => {
      if (settled) return;
      settled = true;
      server.close(() => resolve(free));
    };
    server.once("error", () => finish(false));
    server.listen(port, probeHost(host), () => finish(true));
  });
}

function recordActivePort(records, identity, port) {
  return records.some(({ record }) => record.target_identity !== identity && record.port === port);
}

export async function choosePort(config, identity, stateDir, { portFree = portIsFree } = {}) {
  const records = listRecords(stateDir);
  const requested = config.port;
  const explicit = config.port_was_explicit === true;
  const namedTarget = config.session_name !== null || config.socket_path !== null;
  const hasDifferentTarget = records.some(({ record }) => record.target_identity !== identity);
  if (explicit) {
    if (recordActivePort(records, identity, requested) || !(await portFree(config.host, requested))) {
      throw new PluginError(`configured bridge port ${requested} is already in use; choose another port`);
    }
    return requested;
  }
  if (!recordActivePort(records, identity, requested) && await portFree(config.host, requested)) return requested;
  if (!namedTarget && !hasDifferentTarget) {
    throw new PluginError(`default bridge port ${requested} is already in use; stop the owner or configure another port`);
  }
  for (let port = config.port_range[0]; port <= config.port_range[1]; port += 1) {
    if (recordActivePort(records, identity, port)) continue;
    if (await portFree(config.host, port)) return port;
  }
  throw new PluginError(`no free bridge port is available in ${config.port_range[0]}-${config.port_range[1]}`);
}

function selectedEnvironment(env, target, serviceId) {
  const result = {
    HERDR_SOCKET_PATH: target.socket_path,
    HERDR_WORLD_SETUP: "never",
    HERDR_WORLD_PLUGIN_SERVICE_ID: serviceId,
    PATH: env.PATH || "/usr/local/bin:/usr/bin:/bin",
  };
  for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "HERDR_CONFIG_PATH", "TMPDIR", "LANG", "LC_ALL"]) {
    if (env[name]) result[name] = env[name];
  }
  return result;
}

function bridgeArguments(config, target, port) {
  const args = [];
  if (target.session_name) args.push("--session", target.session_name);
  args.push("--host", config.host, "--port", String(port));
  if (config.upload_dir) args.push("--upload-dir", config.upload_dir);
  for (const host of config.allowed_hosts) args.push("--allow-host", host);
  for (const origin of config.allowed_origins) args.push("--allow-origin", origin);
  for (const origin of config.allowed_connect_origins) args.push("--allow-connect-origin", origin);
  if (config.bridge_label) args.push("--bridge-label", config.bridge_label);
  return args;
}

function commandForRecord(record) {
  return [record.node_path, record.payload_entrypoint, ...(record.bridge_args ?? [])];
}

function commandSignature(command) {
  return hash(JSON.stringify(command));
}

function configSignature(config) {
  return hash(JSON.stringify({
    host: config.host,
    upload_dir: config.upload_dir,
    allowed_hosts: config.allowed_hosts,
    allowed_origins: config.allowed_origins,
    allowed_connect_origins: config.allowed_connect_origins,
    bridge_label: config.bridge_label,
  }));
}

function pathForSupervisor(stateDir, record, suffix) {
  if (suffix === "service" && record.supervisor === "systemd-user") {
    return path.join(stateDir, "supervisors", record.service_name);
  }
  return path.join(stateDir, "supervisors", `${hash(record.target_identity).slice(0, 32)}.${suffix}`);
}

function systemdEscape(value) {
  return `"${String(value).replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"').replace(/[\r\n]/g, "")}"`;
}

export function renderSystemdUnit(record, environment) {
  const command = commandForRecord(record).map(systemdEscape).join(" ");
  const lines = [
    "[Unit]",
    "Description=Herdr World bridge",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${command}`,
    "Restart=on-failure",
    "RestartSec=1",
  ];
  for (const [key, value] of Object.entries(environment)) lines.push(`Environment=${systemdEscape(`${key}=${value}`)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function systemdUnit(record, environment, unitPath) {
  atomicWrite(unitPath, renderSystemdUnit(record, environment));
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistString(value) {
  return `<string>${xmlEscape(value)}</string>`;
}

export function renderLaunchdPlist(record, environment, logPath) {
  const programArguments = commandForRecord(record).map(plistString).join("");
  const environmentVariables = Object.entries(environment)
    .map(([key, value]) => `<key>${xmlEscape(key)}</key>${plistString(value)}`)
    .join("");
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${plistString(record.service_name)}
<key>ProgramArguments</key><array>${programArguments}</array>
<key>EnvironmentVariables</key><dict>${environmentVariables}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key>${plistString(logPath)}
<key>StandardErrorPath</key>${plistString(logPath)}
</dict></plist>
`;
  return content;
}

function launchdPlist(record, environment, plistPath, logPath) {
  atomicWrite(plistPath, renderLaunchdPlist(record, environment, logPath));
}

function supervisorCommand(name, env) {
  const override = env[name];
  if (override) return resolveExecutable(name === "HERDR_WORLD_SYSTEMCTL" ? "systemctl" : "launchctl", { env, explicitPath: override });
  return resolveExecutable(name === "HERDR_WORLD_SYSTEMCTL" ? "systemctl" : "launchctl", { env });
}

function runChecked(command, args, options = {}) {
  const result = commandResult(command, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout ?? RUNTIME_TIMEOUT_MS,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new PluginError(`${path.basename(command)} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || `exit status ${result.status}`).trim();
    throw new PluginError(`${path.basename(command)} ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout ?? "").trim();
}

function systemdAvailable(env) {
  let command;
  try {
    command = supervisorCommand("HERDR_WORLD_SYSTEMCTL", env);
  } catch {
    return null;
  }
  const result = commandResult(command, ["--user", "show-environment"], { env, timeout: RUNTIME_TIMEOUT_MS });
  if (result.status !== 0) return null;
  return command;
}

function launchdAvailable(env) {
  let command;
  try {
    command = supervisorCommand("HERDR_WORLD_LAUNCHCTL", env);
  } catch {
    return null;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) return null;
  const result = commandResult(command, ["print", `gui/${uid}`], { env, timeout: RUNTIME_TIMEOUT_MS });
  if (result.status !== 0) return null;
  return command;
}

export function selectSupervisor(platform, env) {
  if (platform === "linux") {
    const systemctl = systemdAvailable(env);
    if (systemctl) return { kind: "systemd-user", command: systemctl };
  }
  if (platform === "darwin") {
    const launchctl = launchdAvailable(env);
    if (launchctl) return { kind: "launchd", command: launchctl };
  }
  return { kind: "fallback", command: null };
}

function createRecord({ identity, target, config, payload, node, port, supervisor, root, env }) {
  const args = bridgeArguments(config, target, port);
  const record = {
    schema_version: SERVICE_SCHEMA_VERSION,
    target_identity: identity,
    session_name: target.session_name,
    socket_path: target.socket_path,
    host: config.host,
    port,
    url: bridgeUrl(config.host, port),
    package_name: PACKAGE_NAME,
    package_version: payload.packageJson.version,
    payload_root: payload.packageRoot,
    payload_entrypoint: payload.entrypoint,
    node_path: node.path,
    supervisor: supervisor.kind,
    service_name: serviceName(identity, supervisor.kind),
    pid: 0,
    application_version: payload.packageJson.version,
    herdr_protocol: TERMINAL_PROTOCOL,
    bridge_args: args,
    command_signature: commandSignature([node.path, payload.entrypoint, ...args]),
    config_signature: configSignature(config),
    root: path.resolve(root),
    updated_at: new Date().toISOString(),
  };
  return { record, environment: selectedEnvironment(env, target, record.service_name) };
}

function spawnFallback(record, environment, stateDir) {
  const logPath = pathForSupervisor(stateDir, record, "log");
  const fd = openSync(logPath, "a", 0o600);
  try {
    const child = spawn(record.node_path, commandForRecord(record).slice(1), {
      cwd: record.root,
      env: environment,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    if (!Number.isInteger(child.pid)) throw new PluginError("fallback supervisor did not return a process id");
    child.unref();
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

function startUnderSupervisor(record, environment, stateDir, supervisor) {
  if (supervisor.kind === "fallback") return spawnFallback(record, environment, stateDir);
  if (supervisor.kind === "systemd-user") {
    const unitPath = pathForSupervisor(stateDir, record, "service");
    systemdUnit(record, environment, unitPath);
    runChecked(supervisor.command, ["--user", "link", unitPath]);
    runChecked(supervisor.command, ["--user", "daemon-reload"]);
    runChecked(supervisor.command, ["--user", "start", record.service_name]);
    return systemdPid(record, supervisor.command);
  }
  const plistPath = pathForSupervisor(stateDir, record, "plist");
  const logPath = pathForSupervisor(stateDir, record, "log");
  launchdPlist(record, environment, plistPath, logPath);
  const domain = `gui/${process.getuid()}`;
  runChecked(supervisor.command, ["bootstrap", domain, plistPath]);
  runChecked(supervisor.command, ["kickstart", "-k", `${domain}/${record.service_name}`]);
  return launchdPid(record, supervisor.command);
}

function parsePid(value) {
  const pid = Number(String(value).trim());
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function systemdPid(record, command) {
  try {
    return parsePid(runChecked(command, ["--user", "show", record.service_name, "--property=MainPID", "--value"]));
  } catch {
    return 0;
  }
}

function launchdPid(record, command) {
  try {
    const output = runChecked(command, ["print", `gui/${process.getuid()}/${record.service_name}`]);
    return parsePid(output.match(/\bpid\s*=\s*(\d+)/)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

function processCommandLine(pid, platform = process.platform) {
  if (!pid) return "";
  if (platform === "linux") {
    try {
      return readFileSync(`/proc/${pid}/cmdline`).toString().replaceAll("\0", " ").trim();
    } catch {
      return "";
    }
  }
  try {
    return commandOutput(resolveExecutable("ps", { env: process.env }), ["-p", String(pid), "-o", "command="], { timeout: RUNTIME_TIMEOUT_MS });
  } catch {
    return "";
  }
}

export function processMatchesRecord(record, commandLine) {
  if (!commandLine || !record?.node_path || !record?.payload_entrypoint) return false;
  return commandLine.includes(record.node_path) && commandLine.includes(record.payload_entrypoint) &&
    record.command_signature === commandSignature(commandForRecord(record));
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function supervisorStatus(record, supervisor, platform = process.platform) {
  if (record.supervisor === "fallback") {
    const alive = processExists(record.pid);
    const commandLine = alive ? processCommandLine(record.pid, platform) : "";
    return {
      active: alive,
      pid: record.pid,
      owned: !alive || processMatchesRecord(record, commandLine),
      detail: alive ? (commandLine || "running") : "not running",
    };
  }
  if (record.supervisor === "systemd-user") {
    try {
      const activeState = runChecked(supervisor.command, ["--user", "show", record.service_name, "--property=ActiveState", "--value"]);
      const subState = runChecked(supervisor.command, ["--user", "show", record.service_name, "--property=SubState", "--value"]);
      const pid = systemdPid(record, supervisor.command);
      const active = activeState === "active" && subState !== "dead" && subState !== "failed";
      const commandLine = pid ? processCommandLine(pid, platform) : "";
      return { active, pid, owned: !active || processMatchesRecord(record, commandLine), detail: `${activeState}/${subState}` };
    } catch (error) {
      return { active: false, pid: 0, owned: true, detail: `supervisor unavailable: ${error.message}` };
    }
  }
  try {
    const output = runChecked(supervisor.command, ["print", `gui/${process.getuid()}/${record.service_name}`]);
    const pid = parsePid(output.match(/\bpid\s*=\s*(\d+)/)?.[1] ?? 0);
    const active = Boolean(pid) || /state\s*=\s*(running|spawned)/.test(output);
    const commandLine = pid ? processCommandLine(pid, platform) : "";
    return { active, pid, owned: !active || processMatchesRecord(record, commandLine), detail: active ? "loaded" : "not loaded" };
  } catch (error) {
    return { active: false, pid: 0, owned: true, detail: `supervisor unavailable: ${error.message}` };
  }
}

function supervisorForRecord(record, env, platform = process.platform) {
  if (record.supervisor === "fallback") return { kind: "fallback", command: null };
  if (record.supervisor === "systemd-user") {
    const command = systemdAvailable(env);
    if (!command) throw new PluginError("recorded systemd --user supervisor is unavailable; do not signal the recorded process manually");
    return { kind: "systemd-user", command };
  }
  if (record.supervisor === "launchd") {
    const command = launchdAvailable(env);
    if (!command) throw new PluginError("recorded launchd supervisor is unavailable; do not signal the recorded process manually");
    return { kind: "launchd", command };
  }
  throw new PluginError(`unknown recorded supervisor: ${record.supervisor}`);
}

function expectedService(record) {
  return serviceName(record.target_identity, record.supervisor);
}

function assertRecordOwnership(record, env, platform = process.platform) {
  if (!record || record.schema_version !== SERVICE_SCHEMA_VERSION) throw new PluginError("service record is missing or has an unsupported schema");
  if (record.package_name !== PACKAGE_NAME || record.service_name !== expectedService(record)) {
    throw new PluginError("service record ownership is stale; refusing to signal an unrelated process");
  }
  const supervisor = supervisorForRecord(record, env, platform);
  const state = supervisorStatus(record, supervisor, platform);
  if (state.active && !state.owned) throw new PluginError("recorded service ownership is stale; refusing to signal an unrelated process");
  return { supervisor, state };
}

function stopProcessGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (!(["ESRCH", "EPERM"].includes(error.code))) throw error;
  }
}

async function waitForStopped(record, supervisor, platform = process.platform) {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = supervisorStatus(record, supervisor, platform);
    if (!state.active) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new PluginError(`service ${record.service_name} did not stop within ${STOP_TIMEOUT_MS}ms`);
}

async function stopRecord(record, env, platform = process.platform) {
  const { supervisor, state } = assertRecordOwnership(record, env, platform);
  if (!state.active) return { stopped: false, state };
  if (record.supervisor === "fallback") {
    stopProcessGroup(record.pid);
  } else if (record.supervisor === "systemd-user") {
    runChecked(supervisor.command, ["--user", "stop", record.service_name]);
  } else {
    runChecked(supervisor.command, ["bootout", `gui/${process.getuid()}/${record.service_name}`]);
  }
  await waitForStopped(record, supervisor, platform);
  if (record.supervisor === "systemd-user") {
    try {
      runChecked(supervisor.command, ["--user", "disable", record.service_name]);
    } catch {
      // A stopped unit may already have been disabled by the user supervisor.
    }
  }
  return { stopped: true, state };
}

function recordCompatible(record, manifestVersion, payload, config, target, node) {
  return record?.schema_version === SERVICE_SCHEMA_VERSION &&
    record.package_version === manifestVersion &&
    record.payload_entrypoint === payload.entrypoint &&
    record.payload_root === payload.packageRoot &&
    record.node_path === node.path &&
    record.host === config.host &&
    record.socket_path === target.socket_path &&
    record.session_name === target.session_name &&
    (config.port_was_explicit !== true || record.port === config.port) &&
    record.config_signature === configSignature(config) &&
    record.command_signature === commandSignature(commandForRecord(record));
}

async function currentRecordReadiness(record) {
  if (!record?.url) return { ready: false, error: "service record has no URL" };
  const result = await probeCapabilities(probeUrl(record.host, record.port));
  if (!result.ok) return { ready: false, error: result.error };
  const error = safeCapability(result.capabilities, record.package_version);
  return error ? { ready: false, error } : { ready: true, capabilities: result.capabilities };
}

function displayTarget(recordOrTarget) {
  if (recordOrTarget.session_name) return `session ${recordOrTarget.session_name}`;
  const socket = recordOrTarget.socket_path;
  return socket ? `socket …/${path.basename(socket)}` : "no selected socket";
}

function displayPosture(host) {
  return isLoopbackHost(host) ? "loopback-only" : "remotely exposed; Host/Origin checks are not authentication";
}

function printService(record, capabilities, prefix = "Herdr World") {
  console.log(`${prefix}: ${record.url}`);
  console.log(`  target: ${displayTarget(record)}`);
  console.log(`  supervisor: ${record.supervisor} (${record.service_name})`);
  console.log(`  pid: ${record.pid || "not reported"}`);
  console.log(`  compatibility: Herdr ${capabilities?.herdr_version ?? "unknown"}, protocol ${capabilities?.terminal_protocol ?? "unknown"}, web ${capabilities?.web_compat ?? "unknown"}`);
  console.log(`  access: ${displayPosture(record.host)}`);
}

function prepareStart({ root = ROOT, env = process.env, platform = process.platform, arch = process.arch, glibcVersion } = {}) {
  const manifestVersion = readManifestVersion(root);
  const targetPlatform = selectTarget({ platform, arch, glibcVersion });
  const node = checkNode(resolveNode({ env }));
  const context = runtimeContext(env);
  const targetStatus = resolveHerdrTarget(context.config, env);
  const target = { ...context.target, socket_path: targetStatus.socket_path };
  const payload = requirePayload(root, manifestVersion, targetPlatform.target);
  const supervisor = selectSupervisor(platform, env);
  return { root, env, platform, context, manifestVersion, targetPlatform, node, target, payload, supervisor };
}

async function startPrepared(plan, { lockHeld = false } = {}) {
  const { root, env, platform, context, manifestVersion, node, target, payload, supervisor } = plan;
  const start = async () => {
    const recordPath = targetRecordPath(context.stateDir, context.target.identity);
    const previous = readRecord(recordPath);
    if (previous) {
      const ownership = assertRecordOwnership(previous, env, platform);
      if (ownership.state.active && recordCompatible(previous, manifestVersion, payload, context.config, target, node)) {
        const ready = await currentRecordReadiness(previous);
        if (ready.ready) {
          printService(previous, ready.capabilities, "Herdr World already running");
          return previous;
        }
      }
      if (ownership.state.active) await stopRecord(previous, env, platform);
      removeRecord(recordPath);
    }
    const port = await choosePort(context.config, context.target.identity, context.stateDir);
    const { record, environment } = createRecord({
      identity: context.target.identity,
      target,
      config: context.config,
      payload,
      node,
      port,
      supervisor,
      root,
      env,
    });
    let started = false;
    try {
      record.pid = startUnderSupervisor(record, environment, context.stateDir, supervisor);
      record.updated_at = new Date().toISOString();
      writeRecord(recordPath, record);
      started = true;
      const capabilities = await waitForReadiness(probeUrl(record.host, record.port), record);
      record.herdr_protocol = capabilities.terminal_protocol;
      record.pid = supervisor.kind === "systemd-user" ? systemdPid(record, supervisor.command) : supervisor.kind === "launchd" ? launchdPid(record, supervisor.command) : record.pid;
      record.updated_at = new Date().toISOString();
      writeRecord(recordPath, record);
      printService(record, capabilities);
      return record;
    } catch (error) {
      if (started) {
        try { await stopRecord(record, env, platform); } catch {}
      } else if (record.supervisor === "systemd-user") {
        try {
          runChecked(supervisor.command, ["--user", "disable", record.service_name]);
        } catch {}
      }
      removeRecord(recordPath);
      if (error instanceof PluginError) throw error;
      throw new PluginError(`could not start Herdr World: ${error.message}`);
    }
  };
  return lockHeld ? start() : withTargetLock(context.stateDir, context.target.identity, start);
}

async function startAction(options = {}) {
  return startPrepared(prepareStart(options));
}

async function startupAction(options = {}) {
  return startAction(options);
}

function contextRecord(context) {
  return readRecord(targetRecordPath(context.stateDir, context.target.identity));
}

async function stopAction({ root = ROOT, env = process.env, platform = process.platform } = {}) {
  const context = runtimeContext(env);
  const recordPath = targetRecordPath(context.stateDir, context.target.identity);
  const record = readRecord(recordPath);
  if (!record) {
    console.log(`Herdr World is not running for ${displayTarget(context.target)}`);
    return null;
  }
  await stopRecord(record, env, platform);
  removeRecord(recordPath);
  console.log(`Stopped Herdr World for ${displayTarget(record)}.`);
  console.log("The bridge disconnected browser clients; it did not stop the Herdr server or its panes.");
  return record;
}

export async function restartAction(options = {}) {
  const plan = prepareStart(options);
  const { context, env, platform } = plan;
  const recordPath = targetRecordPath(context.stateDir, context.target.identity);
  return withTargetLock(context.stateDir, context.target.identity, async () => {
    const record = readRecord(recordPath);
    if (record) {
      await stopRecord(record, env, platform);
      removeRecord(recordPath);
      console.log("Restarting Herdr World; browser clients will disconnect briefly.");
    }
    return startPrepared(plan, { lockHeld: true });
  });
}

async function statusAction({ env = process.env, platform = process.platform } = {}) {
  const context = runtimeContext(env);
  const recordPath = targetRecordPath(context.stateDir, context.target.identity);
  const record = readRecord(recordPath);
  if (!record) {
    console.log(`Herdr World is not running for ${displayTarget(context.target)}.`);
    console.log(`  access: ${displayPosture(context.config.host)}`);
    return null;
  }
  let ownership;
  try {
    ownership = assertRecordOwnership(record, env, platform);
  } catch (error) {
    console.error(`Herdr World service state is stale: ${error.message}`);
    console.error("No process was signaled. Inspect or remove the stale service through its recorded supervisor.");
    throw error;
  }
  const ready = ownership.state.active ? await currentRecordReadiness(record) : { ready: false, error: "service is not running" };
  printService(record, ready.ready ? ready.capabilities : undefined, ready.ready ? "Herdr World" : "Herdr World not ready");
  console.log(`  service state: ${ownership.state.detail}${ready.error ? ` (${ready.error})` : ""}`);
  return record;
}

async function openAction(options = {}) {
  const record = await startAction(options);
  const platform = options.platform ?? process.platform;
  const openerName = platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
  if (!openerName) {
    console.log(`Open this URL in a browser: ${record.url}`);
    return record;
  }
  try {
    const opener = resolveExecutable(openerName, { env: options.env ?? process.env });
    const result = spawnSync(opener, [record.url], {
      stdio: "ignore",
      timeout: RUNTIME_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) console.log(`Browser helper ${openerName} was unavailable; open ${record.url} manually.`);
  } catch {
    console.log(`No desktop browser helper is available; open ${record.url} manually.`);
  }
  return record;
}

function doctorCheck(checks, label, callback) {
  try {
    const result = callback();
    checks.push({ label, ok: true, detail: result ?? "ok" });
    return result;
  } catch (error) {
    checks.push({ label, ok: false, detail: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function doctorCheckAsync(checks, label, callback) {
  try {
    const result = await callback();
    checks.push({ label, ok: true, detail: result ?? "ok" });
    return result;
  } catch (error) {
    checks.push({ label, ok: false, detail: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function doctorAction({ root = ROOT, env = process.env, platform = process.platform, arch = process.arch, glibcVersion } = {}) {
  const checks = [];
  const targetPlatform = doctorCheck(checks, "platform and libc", () => selectTarget({ platform, arch, glibcVersion }).target);
  let directories;
  doctorCheck(checks, "Herdr plugin config/state directories", () => {
    directories = ensureRuntimeDirectories(env);
    return `${directories.configDir}, ${directories.stateDir}`;
  });
  let config;
  if (directories) config = doctorCheck(checks, "configuration", () => loadConfig(directories.configDir));
  let node;
  node = doctorCheck(checks, "Node.js version and absolute path", () => {
    const resolved = checkNode(resolveNode({ env }));
    return `${resolved.version} at ${resolved.path}`;
  });
  doctorCheck(checks, "npm availability", () => {
    const npm = resolveExecutable("npm", { env, explicitPath: env.HERDR_WORLD_NPM_PATH });
    return `${toolVersion(npm, ["--version"])} at ${npm}`;
  });
  if (config) doctorCheck(checks, "Herdr target compatibility", () => {
    const resolved = resolveHerdrTarget(config, env);
    return `Herdr ${resolved.version}, protocol ${resolved.protocol}, ${displayTarget(resolved)}`;
  });
  const manifestVersion = doctorCheck(checks, "plugin manifest", () => readManifestVersion(root));
  if (manifestVersion && targetPlatform) doctorCheck(checks, "private npm payload", () => {
    const payload = requirePayload(root, manifestVersion, targetPlatform);
    return `${PACKAGE_NAME}@${payload.packageJson.version} (${targetPlatform})`;
  });
  let record;
  let recordPath;
  if (directories && config) {
    let targetIdentity;
    doctorCheck(checks, "target identity", () => {
      targetIdentity = resolveTargetIdentity(config, env);
      return `${targetIdentity.identity} (${displayTarget(targetIdentity)})`;
    });
    if (targetIdentity) {
      recordPath = targetRecordPath(directories.stateDir, targetIdentity.identity);
      doctorCheck(checks, "service record", () => {
        record = contextRecord({ stateDir: directories.stateDir, target: targetIdentity });
        return record ? `${record.supervisor} ${record.url}` : null;
      });
      if (!record) checks.push({ label: "service ownership", ok: true, detail: "no recorded service" });
    }
  }
  if (record) {
    const ownership = doctorCheck(checks, "service ownership", () => assertRecordOwnership(record, env, platform));
    if (ownership) {
      await doctorCheckAsync(checks, "service port", async () => ownership.state.active ? "occupied by recorded service" : "available");
      if (ownership.state.active) await doctorCheckAsync(checks, "capability readiness", async () => {
        const readiness = await currentRecordReadiness(record);
        if (!readiness.ready) throw new PluginError(readiness.error);
        return `Herdr ${readiness.capabilities.herdr_version}, protocol ${readiness.capabilities.terminal_protocol}`;
      });
    }
    if (record) {
      doctorCheck(checks, "recorded Node path", () => {
        const recorded = checkNode(record.node_path);
        return `${recorded.version} at ${recorded.path}`;
      });
      if (node && record.node_path !== node.path) checks.push({ label: "current Node matches service", ok: false, detail: `record uses ${record.node_path}; current Node resolves to ${node.path}` });
      else if (node) checks.push({ label: "current Node matches service", ok: true, detail: node.path });
    }
  } else if (config) {
    await doctorCheckAsync(checks, "service port", async () => {
      if (!(await portIsFree(config.host, config.port))) throw new PluginError(`configured bridge port ${config.port} is already in use`);
      return `${config.port} is available`;
    });
  }
  for (const check of checks) console.log(`[${check.ok ? "ok" : "fail"}] ${check.label}: ${typeof check.detail === "string" ? check.detail : JSON.stringify(check.detail)}`);
  const failures = checks.filter((check) => !check.ok);
  if (failures.length > 0) throw new PluginError(`doctor found ${failures.length} issue${failures.length === 1 ? "" : "s"}; fix the failed checks above and retry`);
  console.log("Herdr World doctor found no issues.");
  return checks;
}

export async function runAction(action, options = {}) {
  if (![...ACTIONS, STARTUP_COMMAND].includes(action)) throw new PluginError(`unknown action ${action}; expected ${[...ACTIONS, STARTUP_COMMAND].join(" | ")}`);
  if (action === "build") return buildPayload(options);
  if (action === "start") return startAction(options);
  if (action === STARTUP_COMMAND) return startupAction(options);
  if (action === "stop") return stopAction(options);
  if (action === "restart") return restartAction(options);
  if (action === "status") return statusAction(options);
  if (action === "open") return openAction(options);
  return doctorAction(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [action, ...extra] = process.argv.slice(2);
  if (!action || extra.length > 0 || ![...ACTIONS, STARTUP_COMMAND].includes(action)) {
    console.error(`Usage: herdr-world-plugin.sh ${[...ACTIONS, STARTUP_COMMAND].join(" | ")}`);
    process.exit(2);
  }
  runAction(action).catch((error) => {
    console.error(`Herdr World plugin ${action} failed: ${error.message}`);
    process.exitCode = 1;
  });
}
