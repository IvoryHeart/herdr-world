import { HerdrClient } from "../bridge/herdr-client";
import { loadServerConfig } from "../config/server-config";
import {
  type LocalCoreSetup,
  type LocalCoreSetupOptions,
  setupLocalCore,
} from "../herdr-core/local-setup";
import {
  detectHerdrSetup,
  type HerdrSetupGuard,
  type HerdrSetupResult,
  type HerdrSetupState,
  setupHerdr,
} from "./bootstrap";
import { herdrServiceStatus } from "./service";
import { VERIFIED_HERDR_VERSION } from "./release";
import {
  describeHerdrUpgrade,
  failedHerdrSteps,
  type HerdrUpgradeDeps,
  type HerdrUpgradeReport,
  upgradeHerdr,
} from "./upgrade";

function herdrHelp(): string {
  return `Install and start a local runtime: herdr-core first, or the Herdr server.

Usage:
  herdr-world herdr setup
  herdr-world herdr status
  herdr-world herdr upgrade [--install] [--only-if-missing] [--no-integrations] [--no-plugin] [--json]

With a herdr binary found, setup keeps it (see Core first below for none),
then installs and starts a user service running
\`herdr server\` (systemd user service on Linux, launchd LaunchAgent on macOS,
per-user Task Scheduler task on Windows). Status prints the detected state.
If Herdr is already running, setup registers future startup without restarting it.

Unix installers use --install --only-if-missing to preserve any existing Herdr,
including one appearing during download, without integrations or service changes.

Upgrade brings an older Herdr up to ${VERIFIED_HERDR_VERSION}: it verifies the
release checksum and version, keeps the replaced binary as herdr.previous
(Windows keeps earlier releases through Herdr's installer, and a Herdr installed
by older Herdr World releases moves to Herdr's default location), and asks a
running local server to hand its panes to the new version only when it can
prove nothing supervises it (a daemonized Linux server); otherwise it says that
a restart is needed. It never downgrades
a newer Herdr or server, or replaces a package- or version-managed install.

A normal upgrade also brings this release's harness integrations and plugin up to
date: \`herdr integration install\` for the codex, claude and pi harnesses found
on PATH when their integration is missing or outdated (and after every Herdr
upgrade), and the Herdr World plugin, if installed from GitHub, reinstalled at
this release's tag.

Core first: setup, and upgrade --install, with no Herdr on this computer
keep an installed herdr-core and never install Herdr beside it (setup also
starts that core now and at login). With neither, they install herdr-core with
its official, checksum-verified release steps into ~/.local/bin and start it now
and at login. On Windows (x64) the same steps, from core's install.ps1, put it
in %LOCALAPPDATA%\\Programs\\herdr-core, and a Startup folder shortcut starts it
at login; World connects to it over its named pipe.
`;
}

export interface HerdrCommandDeps {
  loadConfig?: typeof loadServerConfig;
  detect?: () => Promise<HerdrSetupState>;
  setup?: () => Promise<HerdrSetupResult>;
  upgrade?: (
    options: Pick<
      HerdrUpgradeDeps,
      "installMissing" | "onlyIfMissing" | "integrations" | "plugin"
    >,
  ) => Promise<HerdrUpgradeReport>;
  serviceStatus?: () => { installed: boolean; active: boolean };
  /** The core-first choice for setup and `upgrade --install` with no Herdr. */
  coreSetup?: (
    options: Pick<LocalCoreSetupOptions, "setUp" | "log" | "platform">,
  ) => Promise<LocalCoreSetup>;
  platform?: NodeJS.Platform;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const UPGRADE_FLAGS = [
  "--only-if-missing",
  "--install",
  "--no-integrations",
  "--no-plugin",
  "--json",
];

// loadServerConfig parses process.argv strictly, so remove the herdr words and
// their flags first. Guarded so tests (and unusual argv layouts) never mutate argv.
function stripHerdrArgv(args: string[]) {
  if (args.every((arg, index) => process.argv[2 + index] === arg)) {
    process.argv.splice(2, args.length);
  }
}

/**
 * Handle `herdr-world herdr ...`. Returns null when argv is not a herdr command,
 * matching the runServiceCommand convention.
 */
export async function runHerdrCommand(
  args: string[],
  appVersion: string,
  dependencies: HerdrCommandDeps = {},
): Promise<number | null> {
  if (args[0] !== "herdr") return null;
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;
  const action = args[1];
  if (
    args.length === 1 ||
    action === "help" ||
    action === "--help" ||
    action === "-h"
  ) {
    log(herdrHelp());
    return 0;
  }
  if (action !== "setup" && action !== "status" && action !== "upgrade") {
    error(`unknown herdr action: ${action}`);
    error("Run `herdr-world herdr --help` for usage.");
    return 1;
  }
  const flags = args.slice(2);
  const allowed = action === "upgrade" ? UPGRADE_FLAGS : [];
  const unknownFlag = flags.find((flag) => !allowed.includes(flag));
  if (unknownFlag) {
    error(`unknown herdr ${action} option: ${unknownFlag}`);
    error("Run `herdr-world herdr --help` for usage.");
    return 1;
  }

  try {
    stripHerdrArgv(args);
    const loadConfig = dependencies.loadConfig ?? loadServerConfig;
    const config = loadConfig(appVersion);
    const guard: HerdrSetupGuard = {
      sshHost: config.sshHost,
      session: config.session,
      hasExplicitSocketPath: config.hasExplicitSocketPath,
      hasExplicitClientSocketPath: config.hasExplicitClientSocketPath,
    };
    const ping = () => new HerdrClient(config.socketPath).ping();
    const detect =
      dependencies.detect ?? (() => detectHerdrSetup({ guard, ping }));
    const serviceStatus = dependencies.serviceStatus ?? herdrServiceStatus;

    if (action === "status") {
      const state = await detect();
      if (state.state === "running") {
        log(
          `Herdr is running (version ${state.version}, protocol ${state.protocol}).`,
        );
      } else if (state.state === "installed") {
        log(`Herdr is installed but not running: ${state.binaryPath}`);
        log("Run `herdr-world herdr setup` to start it as a user service.");
      } else {
        log("Herdr is not installed.");
        log(
          "Run `herdr-world herdr setup` to set up a runtime: an installed herdr-core is kept, otherwise herdr-core is installed.",
        );
      }
      const service = serviceStatus();
      log(
        `Managed service: ${
          service.installed
            ? service.active
              ? "installed, active"
              : "installed, inactive"
            : "not installed"
        }`,
      );
      return 0;
    }

    const platform = dependencies.platform ?? process.platform;
    // A remote default connection keeps its own Herdr.
    if (
      (action === "setup" ||
        (action === "upgrade" && flags.includes("--install"))) &&
      !config.sshHost &&
      (await detect()).state === "missing"
    ) {
      const json = flags.includes("--json");
      const core = await (dependencies.coreSetup ?? setupLocalCore)({
        setUp: action === "setup",
        log: json ? error : log,
        platform,
      });
      if (json) log(JSON.stringify({ runtime: "herdr-core", ...core }));
      else for (const line of describeCoreSetup(core)) log(line);
      if (core.outcome === "failed") {
        error(`herdr-world herdr: ${core.error}`);
        return 1;
      }
      return 0;
    }

    if (action === "upgrade") {
      const upgrade =
        dependencies.upgrade ??
        ((options) =>
          upgradeHerdr({
            ...options,
            worldVersion: appVersion,
            log: error,
            // A remote default connection keeps its own Herdr.
            server: config.sshHost
              ? undefined
              : {
                  socketPath: config.socketPath,
                  ping,
                  call: (method, params, timeoutMs) =>
                    new HerdrClient(config.socketPath).call(
                      method,
                      params,
                      timeoutMs,
                    ),
                },
          }));
      const report = await upgrade({
        installMissing: flags.includes("--install"),
        ...(flags.includes("--only-if-missing") ? { onlyIfMissing: true } : {}),
        integrations: !flags.includes("--no-integrations"),
        plugin: !flags.includes("--no-plugin"),
      });
      if (flags.includes("--json")) log(JSON.stringify(report));
      else if (
        flags.includes("--only-if-missing") &&
        report.binary === "unchanged" &&
        report.binaryPath
      ) {
        log("Existing Herdr installation was left unchanged.");
      } else for (const line of describeHerdrUpgrade(report)) log(line);
      return failedHerdrSteps(report).length ? 1 : 0;
    }

    const setup = dependencies.setup ?? (() => setupHerdr({ guard, ping }));
    const result = await setup();
    if (result.outcome === "already-running") {
      log(
        `Herdr is already running (version ${result.version}, protocol ${result.protocol}); user service registered for future logins.`,
      );
    } else {
      log(
        result.outcome === "started"
          ? `Started Herdr ${result.version} as a user service.`
          : `Installed Herdr ${result.version} and started it as a user service.`,
      );
      log(`Binary: ${result.binaryPath}`);
    }
    return 0;
  } catch (cause) {
    error(`herdr-world herdr: ${(cause as Error).message}`);
    error("Run `herdr-world herdr --help` for usage.");
    return 1;
  }
}

function describeCoreSetup(core: LocalCoreSetup): string[] {
  if (core.outcome === "kept")
    return [
      `herdr-core is installed at ${core.core}; it is kept as it is, so no Herdr was installed.`,
      CONNECT_HINT,
    ];
  if (core.outcome === "set-up")
    return [
      core.installed
        ? "herdr-core is installed and running, and starts at login; no Herdr was installed."
        : `herdr-core at ${core.core} is running and starts at login; it was not replaced, and no Herdr was installed.`,
      CONNECT_HINT,
    ];
  return [];
}

const CONNECT_HINT =
  "To connect World to it, use Install herdr-core on This computer in Hosts > Manage connections; an installed core is set up, never replaced.";
