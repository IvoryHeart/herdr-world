import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import { findHerdrBinary, type HerdrBootstrapDeps } from "./bootstrap";
import {
  type InstallHerdrDeps,
  installVerifiedHerdr,
  parseHerdrVersion,
  readHerdrVersion,
  replaceWithVerifiedHerdr,
  VERIFIED_HERDR_PROTOCOL,
  VERIFIED_HERDR_VERSION,
} from "./release";

/**
 * Herdr World declares one verified Herdr release (release.ts). This module
 * brings the local Herdr up to it as a separate, reported step: the binary
 * (with a rollback copy), the running server (live handoff when it is safe),
 * then the agent integrations and the Herdr World plugin through Herdr's own
 * commands.
 */

export type HerdrUpgradePlan =
  | { state: "missing" }
  | {
      state: "current" | "newer" | "outdated";
      binaryPath: string;
      version: string;
    }
  | {
      state: "package-managed";
      binaryPath: string;
      version: string | null;
      command: string;
    }
  | { state: "unknown"; binaryPath: string; reason: string };

export type HerdrServerOutcome =
  | "current"
  | "handed-off"
  | "restart-required"
  | "not-running"
  | "skipped";

export interface HerdrStepReport {
  target: string;
  action: "installed" | "updated" | "current" | "skipped" | "failed";
  detail?: string;
}

export interface HerdrUpgradeReport {
  before: HerdrUpgradePlan;
  binary: "installed" | "upgraded" | "unchanged";
  binaryPath?: string;
  version?: string;
  backupPath?: string;
  server: { outcome: HerdrServerOutcome; detail?: string };
  integrations: HerdrStepReport[];
  plugin: HerdrStepReport;
}

type Run = typeof runProcessWithCodeTimeout;

export interface HerdrUpgradeDeps
  extends InstallHerdrDeps,
    Pick<HerdrBootstrapDeps, "pathEnv" | "binPathEnv"> {
  /** This Herdr World's version; the World plugin follows it. */
  worldVersion: string;
  /** Install Herdr when none is found (installers and first run). */
  installMissing?: boolean;
  integrations?: boolean;
  plugin?: boolean;
  /** Local Herdr server of World's default connection; absent for SSH. */
  server?: {
    ping: () => Promise<{
      version?: unknown;
      protocol?: unknown;
      capabilities?: { live_handoff?: unknown } | null;
    }>;
    call: (
      method: string,
      params: Record<string, unknown>,
      timeoutMs: number,
    ) => Promise<unknown>;
    /** A supervisor (Herdr World's Herdr service) restarts the server on exit. */
    supervised: boolean;
  };
  run?: Run;
  sleep?: (ms: number) => Promise<void>;
  handoffConfirmTimeoutMs?: number;
  log?: (message: string) => void;
}

/** Agents whose Herdr integrations Herdr World keeps current, by command. */
export const WORLD_AGENT_INTEGRATIONS = [
  { target: "codex", command: "codex" },
  { target: "claude", command: "claude" },
  { target: "pi", command: "pi" },
] as const;

export const WORLD_PLUGIN_ID = "ivoryheart.herdr-world";
export const WORLD_PLUGIN_SOURCE = "IvoryHeart/herdr-world";

const CLI_TIMEOUT_MS = 30_000;
const PLUGIN_TIMEOUT_MS = 300_000;
// Herdr's own updater allows these for the handoff request and confirmation.
const HANDOFF_REQUEST_TIMEOUT_MS = 240_000;
const HANDOFF_CONFIRM_TIMEOUT_MS = 30_000;

/** Negative when a < b. Pre-releases sort before their release. */
export function compareHerdrVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.split("-", 2);
    return { parts: core.split(".").map(Number), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** Package-manager installs update through their manager, as Herdr's do. */
export function packageManagerUpdateCommand(binaryPath: string): string | null {
  let resolved = binaryPath;
  try {
    resolved = realpathSync(binaryPath);
  } catch {
    // Keep the unresolved path.
  }
  for (const path of [binaryPath, resolved]) {
    if (
      path.includes("/Cellar/") ||
      path.startsWith("/opt/homebrew/") ||
      path.startsWith("/home/linuxbrew/.linuxbrew/")
    )
      return "brew update && brew upgrade herdr";
    if (path.includes("/mise/installs/")) return "mise upgrade herdr";
    if (path.startsWith("/nix/store/"))
      return "update Herdr through Nix (nix profile upgrade or your flake input)";
  }
  return null;
}

function writable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function planHerdrUpgrade(
  deps: Omit<HerdrUpgradeDeps, "worldVersion"> = {},
): HerdrUpgradePlan {
  const binaryPath = findHerdrBinary(deps);
  if (!binaryPath) return { state: "missing" };
  const version = parseHerdrVersion(
    (deps.readVersion ?? readHerdrVersion)(binaryPath),
  );
  const command = packageManagerUpdateCommand(binaryPath);
  if (command)
    return { state: "package-managed", binaryPath, version, command };
  if (!version) {
    return {
      state: "unknown",
      binaryPath,
      reason: "`herdr --version` did not report a version",
    };
  }
  const order = compareHerdrVersions(version, VERIFIED_HERDR_VERSION);
  if (order === 0) return { state: "current", binaryPath, version };
  if (order > 0) return { state: "newer", binaryPath, version };
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32" && !writable(dirname(binaryPath))) {
    return {
      state: "unknown",
      binaryPath,
      reason: `${dirname(binaryPath)} is not writable by this user`,
    };
  }
  return { state: "outdated", binaryPath, version };
}

async function bringServerToVerified(
  binaryPath: string,
  changed: boolean,
  deps: HerdrUpgradeDeps,
): Promise<{ outcome: HerdrServerOutcome; detail?: string }> {
  const server = deps.server;
  if (!server) return { outcome: "skipped", detail: "not a local connection" };
  let info: Awaited<ReturnType<typeof server.ping>>;
  try {
    info = await server.ping();
  } catch {
    return changed
      ? {
          outcome: "not-running",
          detail:
            "No Herdr server is running; the next start uses the new binary.",
        }
      : { outcome: "not-running" };
  }
  const running = typeof info.version === "string" ? info.version : "unknown";
  if (running === VERIFIED_HERDR_VERSION) return { outcome: "current" };
  const restart = (reason: string) => ({
    outcome: "restart-required" as const,
    detail: `${reason} The server still runs Herdr ${running}, which this Herdr World supports; restart it when convenient to use ${VERIFIED_HERDR_VERSION}. A restart ends running pane processes.`,
  });
  if ((deps.platform ?? process.platform) === "win32") {
    return restart("Herdr has no live handoff on Windows.");
  }
  if (server.supervised) {
    // The handoff starts the new server as a child of the old one; a
    // supervisor would treat the old server's exit as a crash.
    return restart("This Herdr server runs as a supervised service.");
  }
  if (info.capabilities?.live_handoff !== true) {
    return restart(`Herdr ${running} does not support live handoff.`);
  }
  try {
    await server.call(
      "server.live_handoff",
      {
        import_exe: binaryPath,
        expected_version: VERIFIED_HERDR_VERSION,
        expected_protocol: VERIFIED_HERDR_PROTOCOL,
      },
      HANDOFF_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    // The handoff request ends with the old server's connection; confirm below.
    deps.log?.(`Herdr handoff request: ${(error as Error).message}`);
  }
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline =
    Date.now() + (deps.handoffConfirmTimeoutMs ?? HANDOFF_CONFIRM_TIMEOUT_MS);
  let last = running;
  for (;;) {
    try {
      const after = await server.ping();
      last = typeof after.version === "string" ? after.version : "unknown";
      if (last === VERIFIED_HERDR_VERSION) return { outcome: "handed-off" };
    } catch {
      last = "none";
    }
    if (Date.now() >= deadline) break;
    await sleep(250);
  }
  if (last === "none") {
    return {
      outcome: "not-running",
      detail:
        "Live handoff did not complete and no Herdr server is responding. Start Herdr again; the binary is already updated.",
    };
  }
  return restart(
    "Live handoff did not complete, so the old server kept your panes.",
  );
}

function onPath(command: string, deps: HerdrUpgradeDeps): boolean {
  const platform = deps.platform ?? process.platform;
  const names =
    platform === "win32"
      ? [`${command}.exe`, `${command}.cmd`, `${command}.ps1`]
      : [command];
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? "";
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some((directory) =>
      names.some((name) => existsSync(join(directory, name))),
    );
}

/** `codex: outdated (v4 < v5) (path)` -> codex => outdated. */
export function parseIntegrationStates(stdout: string): Map<string, string> {
  const states = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match =
      /^([a-z][a-z0-9_-]*)(?: \([a-z]+\))?: (current|outdated|not installed)\b/.exec(
        line,
      );
    if (match) states.set(match[1], match[2]);
  }
  return states;
}

async function updateIntegrations(
  binaryPath: string,
  upgraded: boolean,
  deps: HerdrUpgradeDeps,
): Promise<HerdrStepReport[]> {
  const run = deps.run ?? runProcessWithCodeTimeout;
  const present = WORLD_AGENT_INTEGRATIONS.filter((agent) =>
    onPath(agent.command, deps),
  );
  if (!present.length) return [];
  const status = await run(
    [binaryPath, "integration", "status"],
    CLI_TIMEOUT_MS,
  );
  if (status.code !== 0) {
    return present.map((agent) => ({
      target: agent.target,
      action: "failed",
      detail: "`herdr integration status` failed",
    }));
  }
  const states = parseIntegrationStates(status.stdout);
  const reports: HerdrStepReport[] = [];
  for (const agent of present) {
    const state = states.get(agent.target);
    // A new Herdr can change what an integration installs without changing
    // its reported version (0.9.5 removed Codex turn hooks), so reinstall
    // every present agent's integration after an upgrade.
    if (state === "current" && !upgraded) {
      reports.push({ target: agent.target, action: "current" });
      continue;
    }
    const result = await run(
      [binaryPath, "integration", "install", agent.target],
      CLI_TIMEOUT_MS,
    );
    reports.push(
      result.code === 0
        ? {
            target: agent.target,
            action: state === "not installed" ? "installed" : "updated",
          }
        : {
            target: agent.target,
            action: "failed",
            detail: (result.stderr || result.stdout).trim().slice(0, 300),
          },
    );
  }
  return reports;
}

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

async function updateWorldPlugin(
  binaryPath: string,
  deps: HerdrUpgradeDeps,
): Promise<HerdrStepReport> {
  const target = WORLD_PLUGIN_ID;
  const run = deps.run ?? runProcessWithCodeTimeout;
  const listed = await run(
    [binaryPath, "plugin", "list", "--json"],
    CLI_TIMEOUT_MS,
  );
  if (listed.code !== 0) {
    return { target, action: "failed", detail: "`herdr plugin list` failed" };
  }
  let plugin: { version?: unknown; source?: { kind?: unknown } } | undefined;
  try {
    const parsed = JSON.parse(listed.stdout) as {
      result?: { plugins?: { plugin_id?: unknown }[] };
    };
    plugin = parsed.result?.plugins?.find(
      (candidate) => candidate.plugin_id === WORLD_PLUGIN_ID,
    ) as typeof plugin;
  } catch {
    return { target, action: "failed", detail: "unreadable plugin list" };
  }
  if (!plugin) return { target, action: "skipped", detail: "not installed" };
  if (plugin.source?.kind !== "github") {
    return { target, action: "skipped", detail: "locally linked" };
  }
  if (plugin.version === deps.worldVersion)
    return { target, action: "current" };
  if (!RELEASE_VERSION.test(deps.worldVersion)) {
    return {
      target,
      action: "skipped",
      detail: `Herdr World ${deps.worldVersion} is not a published release`,
    };
  }
  // `plugin update` refetches the ref recorded at install, so a plugin pinned
  // to an older tag stays there; reinstall it at this World's release tag.
  const result = await run(
    [
      binaryPath,
      "plugin",
      "install",
      WORLD_PLUGIN_SOURCE,
      "--ref",
      `v${deps.worldVersion}`,
      "--yes",
    ],
    PLUGIN_TIMEOUT_MS,
  );
  return result.code === 0
    ? { target, action: "updated", detail: `v${deps.worldVersion}` }
    : {
        target,
        action: "failed",
        detail: (result.stderr || result.stdout).trim().slice(0, 300),
      };
}

export async function upgradeHerdr(
  deps: HerdrUpgradeDeps,
): Promise<HerdrUpgradeReport> {
  const before = planHerdrUpgrade(deps);
  const report: HerdrUpgradeReport = {
    before,
    binary: "unchanged",
    server: { outcome: "skipped" },
    integrations: [],
    plugin: { target: WORLD_PLUGIN_ID, action: "skipped" },
  };
  let binaryPath: string | undefined;
  let changed = false;
  if (before.state === "missing") {
    if (!deps.installMissing) {
      report.server = { outcome: "skipped", detail: "Herdr is not installed" };
      return report;
    }
    const installed = await installVerifiedHerdr(deps);
    binaryPath = installed.binaryPath;
    report.binary = "installed";
    changed = true;
  } else {
    binaryPath = before.binaryPath;
    if (before.state === "outdated") {
      const replaced = await replaceWithVerifiedHerdr(before.binaryPath, deps);
      binaryPath = replaced.binaryPath;
      report.backupPath = replaced.backupPath;
      report.binary = "upgraded";
      changed = true;
    }
  }
  report.binaryPath = binaryPath;
  report.version = changed
    ? VERIFIED_HERDR_VERSION
    : "version" in before
      ? (before.version ?? undefined)
      : undefined;
  // A current binary can still have an older server from an earlier upgrade.
  if (changed || before.state === "current") {
    report.server = await bringServerToVerified(binaryPath, changed, deps);
  }
  if (deps.integrations !== false) {
    report.integrations = await updateIntegrations(binaryPath, changed, deps);
  }
  if (deps.plugin !== false) {
    report.plugin = await updateWorldPlugin(binaryPath, deps);
  }
  return report;
}

/** Plain-language lines for the CLI, installers and the web notice. */
export function describeHerdrUpgrade(report: HerdrUpgradeReport): string[] {
  const lines: string[] = [];
  const before = report.before;
  if (report.binary === "installed") {
    lines.push(
      `Installed Herdr ${VERIFIED_HERDR_VERSION} at ${report.binaryPath}.`,
    );
  } else if (report.binary === "upgraded" && before.state === "outdated") {
    lines.push(
      `Upgraded Herdr ${before.version} -> ${VERIFIED_HERDR_VERSION} at ${report.binaryPath}.`,
    );
    if (report.backupPath)
      lines.push(`Previous Herdr binary: ${report.backupPath}`);
  } else if (before.state === "missing") {
    lines.push("Herdr is not installed.");
  } else if (before.state === "current") {
    lines.push(
      `Herdr ${before.version} is the version this Herdr World recommends.`,
    );
  } else if (before.state === "newer") {
    lines.push(
      `Herdr ${before.version} is newer than the ${VERIFIED_HERDR_VERSION} this Herdr World verified; it was left unchanged.`,
    );
  } else if (before.state === "package-managed") {
    const label = before.version ? `Herdr ${before.version}` : "Herdr";
    lines.push(
      `${label} is managed by a package manager; upgrade it with: ${before.command}`,
    );
  } else if (before.state === "unknown") {
    lines.push(
      `Herdr at ${before.binaryPath} was left unchanged: ${before.reason}.`,
    );
  }
  const server = report.server;
  if (server.outcome === "handed-off") {
    lines.push("The running Herdr server handed its panes to the new version.");
  } else if (server.outcome !== "skipped" && server.detail) {
    lines.push(server.detail);
  }
  for (const item of report.integrations) {
    if (item.action === "current") continue;
    lines.push(
      `Integration ${item.target}: ${item.action}${item.detail ? ` (${item.detail})` : ""}`,
    );
  }
  const plugin = report.plugin;
  if (plugin.action === "updated" || plugin.action === "failed") {
    lines.push(
      `Herdr World plugin: ${plugin.action}${plugin.detail ? ` (${plugin.detail})` : ""}`,
    );
  }
  return lines;
}
