import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import { findHerdrBinary, type HerdrBootstrapDeps } from "./bootstrap";
import {
  compareHerdrVersions,
  type InstallHerdrDeps,
  installVerifiedHerdr,
  isOfficialWindowsHerdr,
  legacyWindowsHerdrBinaries,
  parseHerdrVersion,
  readHerdrVersion,
  replaceWithVerifiedHerdr,
  VERIFIED_HERDR_PROTOCOL,
  VERIFIED_HERDR_VERSION,
} from "./release";
import { rebindHerdrWindowsTask } from "./service";
import { detectServerSupervision, type ServerSupervision } from "./supervision";

/**
 * Herdr World declares one verified Herdr release (release.ts). This module
 * brings the local Herdr up to it as a separate, reported step: the binary
 * (with a rollback copy), the running server (live handoff only when that is
 * provably safe), then the harness integrations and the Herdr World plugin
 * through Herdr's own commands. The last two also run after a World update
 * that keeps the same Herdr, because they follow the World release.
 */

export type HerdrUpgradePlan =
  | { state: "missing" }
  | { state: "current" | "newer"; binaryPath: string; version: string }
  | {
      state: "outdated";
      binaryPath: string;
      version: string;
      /** Windows: installed by Herdr World 0.2 or earlier in its own directory. */
      legacyWindows?: boolean;
    }
  | {
      state: "package-managed";
      binaryPath: string;
      version: string | null;
      command: string;
    }
  | { state: "unknown"; binaryPath: string; reason: string };

export type HerdrServerOutcome =
  /** Already runs the verified version. */
  | "current"
  | "handed-off"
  /** The old server keeps its panes until someone restarts it. */
  | "restart-required"
  /** Newer or unidentifiable: never handed to an older release. */
  | "left-unchanged"
  | "not-running"
  /** A handoff ended with no server responding. */
  | "lost"
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
  /** Windows: the legacy copy kept after moving Herdr to its default location. */
  migratedFrom?: string;
  taskRebound?: boolean;
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
    socketPath: string;
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
  };
  supervision?: (socketPath: string) => Promise<ServerSupervision>;
  /** Windows: repoint World's Herdr task; false when it does not run fromPath. */
  rebindTask?: (fromPath: string, toPath: string) => boolean;
  run?: Run;
  sleep?: (ms: number) => Promise<void>;
  handoffConfirmTimeoutMs?: number;
  log?: (message: string) => void;
}

/**
 * The harnesses whose Herdr integrations Herdr World needs, by the command
 * that shows the harness is installed. Each present harness gets
 * `herdr integration install <target>` when its integration is missing or
 * outdated, and again after every Herdr upgrade.
 */
export const WORLD_HARNESS_INTEGRATIONS = [
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

export { compareHerdrVersions };

/**
 * Package managers and version managers own their Herdr, as Herdr's own
 * updater assumes. Their shims (mise links to its own executable, asdf
 * writes scripts) must never be replaced by a standalone binary.
 */
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
    if (path.includes("/mise/installs/") || path.includes("/mise/shims/"))
      return "mise upgrade herdr";
    if (path.includes("/.asdf/shims/") || path.includes("/.asdf/installs/"))
      return "asdf install herdr latest";
    if (path.startsWith("/nix/store/"))
      return "update Herdr through Nix (nix profile upgrade or your flake input)";
  }
  // Any other link to something that is not a herdr executable is a shim.
  let link = false;
  try {
    link = lstatSync(binaryPath).isSymbolicLink();
  } catch {
    // A missing path is not a shim.
  }
  const name = basename(resolved).toLowerCase();
  if (link && name !== "herdr" && name !== "herdr.exe")
    return `upgrade Herdr through ${basename(resolved)}, which provides this herdr`;
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

function samePath(a: string, b: string, platform: string): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
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
  if (platform === "win32") {
    // Herdr's Windows installer always writes its own layout, so only a
    // Herdr found there (or World's legacy copy, which is migrated) can be
    // upgraded; anything else would leave the found binary behind.
    if (isOfficialWindowsHerdr(binaryPath, deps))
      return { state: "outdated", binaryPath, version };
    if (
      legacyWindowsHerdrBinaries(deps).some((legacy) =>
        samePath(binaryPath, legacy, platform),
      )
    )
      return { state: "outdated", binaryPath, version, legacyWindows: true };
    return {
      state: "unknown",
      binaryPath,
      reason:
        "it is not in the layout Herdr's installer manages; upgrade it the way it was installed, or remove it so World can install Herdr in Herdr's default location",
    };
  }
  if (!writable(dirname(binaryPath))) {
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
  const running =
    typeof info.version === "string"
      ? parseHerdrVersion(`herdr ${info.version}`)
      : null;
  if (running === VERIFIED_HERDR_VERSION) return { outcome: "current" };
  if (!running) {
    return {
      outcome: "left-unchanged",
      detail:
        "The running Herdr server did not report a version, so it was left as it is.",
    };
  }
  if (compareHerdrVersions(running, VERIFIED_HERDR_VERSION) > 0) {
    return {
      outcome: "left-unchanged",
      detail: `The running Herdr server (${running}) is newer than ${VERIFIED_HERDR_VERSION}, so it was left as it is.`,
    };
  }
  const restart = (reason: string) => ({
    outcome: "restart-required" as const,
    detail: `${reason} The server still runs Herdr ${running}, which this Herdr World supports; restart it when convenient to use ${VERIFIED_HERDR_VERSION}. A restart ends running pane processes.`,
  });
  if ((deps.platform ?? process.platform) === "win32") {
    return restart("Herdr has no live handoff on Windows.");
  }
  if (info.capabilities?.live_handoff !== true) {
    return restart(`Herdr ${running} does not support live handoff.`);
  }
  const supervision = await (
    deps.supervision ??
    ((socketPath: string) =>
      detectServerSupervision(socketPath, { platform: deps.platform }))
  )(server.socketPath);
  if (supervision !== "unsupervised") {
    // The handoff starts the new server as a child of the old one; a
    // supervisor would end it, and the panes, when the old server exits.
    return restart(
      supervision === "supervised"
        ? "This Herdr server runs under a service manager, which would end its panes during a handoff."
        : "World could not confirm that no service manager runs this Herdr server, so it did not risk a handoff.",
    );
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
  let last: string | null = running;
  for (;;) {
    try {
      const after = await server.ping();
      last = typeof after.version === "string" ? after.version : "unknown";
      if (last === VERIFIED_HERDR_VERSION) return { outcome: "handed-off" };
    } catch {
      last = null;
    }
    if (Date.now() >= deadline) break;
    await sleep(250);
  }
  if (last === null) {
    return {
      outcome: "lost",
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

type HarnessPlan =
  | { failed: true }
  | {
      failed: false;
      present: { target: string; state?: string; install: boolean }[];
    };

/** Which present harnesses need `herdr integration install`. */
async function planHarnessIntegrations(
  binaryPath: string,
  upgraded: boolean,
  deps: HerdrUpgradeDeps,
): Promise<HarnessPlan> {
  const present = WORLD_HARNESS_INTEGRATIONS.filter((harness) =>
    onPath(harness.command, deps),
  );
  if (!present.length) return { failed: false, present: [] };
  const run = deps.run ?? runProcessWithCodeTimeout;
  const status = await run(
    [binaryPath, "integration", "status"],
    CLI_TIMEOUT_MS,
  );
  if (status.code !== 0) return { failed: true };
  const states = parseIntegrationStates(status.stdout);
  return {
    failed: false,
    present: present.map(({ target }) => {
      const state = states.get(target);
      // A new Herdr can change what an integration installs without changing
      // its reported version (0.9.5 removed Codex turn hooks), so every
      // present harness is reinstalled after an upgrade.
      return { target, state, install: upgraded || state !== "current" };
    }),
  };
}

async function updateHarnessIntegrations(
  binaryPath: string,
  upgraded: boolean,
  deps: HerdrUpgradeDeps,
): Promise<HerdrStepReport[]> {
  const plan = await planHarnessIntegrations(binaryPath, upgraded, deps);
  if (plan.failed) {
    return WORLD_HARNESS_INTEGRATIONS.filter((harness) =>
      onPath(harness.command, deps),
    ).map(({ target }) => ({
      target,
      action: "failed",
      detail: "`herdr integration status` failed",
    }));
  }
  const run = deps.run ?? runProcessWithCodeTimeout;
  const reports: HerdrStepReport[] = [];
  for (const { target, state, install } of plan.present) {
    if (!install) {
      reports.push({ target, action: "current" });
      continue;
    }
    const result = await run(
      [binaryPath, "integration", "install", target],
      CLI_TIMEOUT_MS,
    );
    reports.push(
      result.code === 0
        ? {
            target,
            action: state === "not installed" ? "installed" : "updated",
          }
        : {
            target,
            action: "failed",
            detail: (result.stderr || result.stdout).trim().slice(0, 300),
          },
    );
  }
  return reports;
}

/**
 * Releases and release candidates are published as `vX.Y.Z[-rc.N]` tags.
 * Pre-merge previews (0.0.0-rc.N) and source builds have no tag to follow.
 */
export function isPublishedWorldVersion(version: string): boolean {
  return (
    /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version) && !version.startsWith("0.0.0")
  );
}

type PluginPlan =
  | { action: "install" }
  | { action: "current" | "skipped" | "failed"; detail?: string };

async function planWorldPlugin(
  binaryPath: string,
  deps: HerdrUpgradeDeps,
): Promise<PluginPlan> {
  const run = deps.run ?? runProcessWithCodeTimeout;
  const listed = await run(
    [binaryPath, "plugin", "list", "--json"],
    CLI_TIMEOUT_MS,
  );
  if (listed.code !== 0)
    return { action: "failed", detail: "`herdr plugin list` failed" };
  let plugin: { version?: unknown; source?: { kind?: unknown } } | undefined;
  try {
    const parsed = JSON.parse(listed.stdout) as {
      result?: { plugins?: { plugin_id?: unknown }[] };
    };
    plugin = parsed.result?.plugins?.find(
      (candidate) => candidate.plugin_id === WORLD_PLUGIN_ID,
    ) as typeof plugin;
  } catch {
    return { action: "failed", detail: "unreadable plugin list" };
  }
  if (!plugin) return { action: "skipped", detail: "not installed" };
  if (plugin.source?.kind !== "github")
    return { action: "skipped", detail: "locally linked" };
  if (plugin.version === deps.worldVersion) return { action: "current" };
  if (!isPublishedWorldVersion(deps.worldVersion)) {
    return {
      action: "skipped",
      detail: `Herdr World ${deps.worldVersion} is not a published release`,
    };
  }
  return { action: "install" };
}

async function updateWorldPlugin(
  binaryPath: string,
  deps: HerdrUpgradeDeps,
): Promise<HerdrStepReport> {
  const target = WORLD_PLUGIN_ID;
  const plan = await planWorldPlugin(binaryPath, deps);
  if (plan.action !== "install") return { target, ...plan };
  // `plugin update` refetches the ref recorded at install, so a plugin pinned
  // to an older tag (or tracking a branch) stays there; reinstall it pinned
  // to this World's release tag.
  const result = await (deps.run ?? runProcessWithCodeTimeout)(
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

/**
 * The work an upgrade would do for this World release besides the binary:
 * harness integrations to install and whether the World plugin needs its tag.
 * Read-only; for the status endpoint and the menu.
 */
export async function pendingHerdrSteps(
  binaryPath: string,
  deps: HerdrUpgradeDeps,
): Promise<string[]> {
  const pending: string[] = [];
  const harnesses = await planHarnessIntegrations(binaryPath, false, deps);
  if (!harnesses.failed)
    for (const harness of harnesses.present)
      if (harness.install) pending.push(harness.target);
  if ((await planWorldPlugin(binaryPath, deps)).action === "install")
    pending.push(WORLD_PLUGIN_ID);
  return pending;
}

/** Steps that did not do what they should; the CLI exits 1 and the UI warns. */
export function failedHerdrSteps(report: HerdrUpgradeReport): string[] {
  const failed = report.integrations
    .filter((item) => item.action === "failed")
    .map((item) => `${item.target} harness integration`);
  if (report.plugin.action === "failed") failed.push("Herdr World plugin");
  if (report.server.outcome === "lost") failed.push("Herdr server handoff");
  return failed;
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
  let binaryPath: string;
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
      if (before.legacyWindows) {
        // The legacy directory stays as the backup; World's task, which
        // starts Herdr at logon, moves to the new location.
        report.migratedFrom = before.binaryPath;
        report.taskRebound = (
          deps.rebindTask ??
          ((from, to) =>
            rebindHerdrWindowsTask(from, to, {
              homeDir: deps.homeDir,
              appDataDir: deps.appDataDir,
            }))
        )(before.binaryPath, binaryPath);
      }
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
    report.integrations = await updateHarnessIntegrations(
      binaryPath,
      changed,
      deps,
    );
  }
  if (deps.plugin !== false) {
    report.plugin = await updateWorldPlugin(binaryPath, deps);
  }
  return report;
}

/** Whether a report changed, or failed to change, anything worth showing. */
export function herdrUpgradeChangedAnything(report: HerdrUpgradeReport) {
  return (
    report.binary !== "unchanged" ||
    report.server.outcome === "handed-off" ||
    report.server.outcome === "restart-required" ||
    report.server.outcome === "lost" ||
    report.integrations.some((item) => item.action !== "current") ||
    report.plugin.action === "updated" ||
    report.plugin.action === "failed"
  );
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
    if (report.migratedFrom) {
      lines.push(
        `Moved Herdr to Herdr's default location. The copy older Herdr World releases installed stays at ${dirname(report.migratedFrom)} as a backup; delete it once Herdr ${VERIFIED_HERDR_VERSION} works.`,
      );
      lines.push(
        report.taskRebound
          ? "Herdr World's Herdr task now starts the new location at the next logon or restart."
          : "No Herdr World task pointed at the old copy, so none was changed.",
      );
    }
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
      `${label} is managed by a package or version manager; ${before.command.startsWith("upgrade") ? before.command : `upgrade it with: ${before.command}`}`,
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
      `${item.target} harness integration: ${item.action}${item.detail ? ` (${item.detail})` : ""}`,
    );
  }
  const plugin = report.plugin;
  if (plugin.action === "updated" || plugin.action === "failed") {
    lines.push(
      `Herdr World plugin: ${plugin.action}${plugin.detail ? ` (${plugin.detail})` : ""}`,
    );
  }
  const failed = failedHerdrSteps(report);
  if (failed.length) {
    lines.push(
      `Not completed: ${failed.join(", ")}. Run \`herdr-world herdr upgrade\` to retry.`,
    );
  }
  return lines;
}
