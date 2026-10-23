import { HerdrClient } from "../bridge/herdr-client";
import { loadServerConfig } from "../config/server-config";
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
  return `Install and start the local Herdr server.

Usage:
  herdr-world herdr setup
  herdr-world herdr status
  herdr-world herdr upgrade [--install] [--no-integrations] [--no-plugin] [--json]

Setup installs the Herdr World-verified Herdr ${VERIFIED_HERDR_VERSION} release
when no herdr binary is found, then installs and starts a user service running
\`herdr server\` (systemd user service on Linux, launchd LaunchAgent on macOS,
per-user Task Scheduler task on Windows). Status prints the detected state.

Upgrade brings an older Herdr up to ${VERIFIED_HERDR_VERSION}: it verifies the
release checksum and version, keeps the replaced binary as herdr.previous
(Windows keeps earlier releases through Herdr's installer, and a Herdr installed
by older Herdr World releases moves to Herdr's default location), and asks a
running local server to hand its panes to the new version only when it can
prove nothing supervises it (a daemonized Linux server); otherwise it says that
a restart is needed. It never downgrades
a newer Herdr or server, or replaces a package- or version-managed install.

Every run also brings this release's harness integrations and plugin up to
date: \`herdr integration install\` for the codex, claude and pi harnesses found
on PATH when their integration is missing or outdated (and after every Herdr
upgrade), and the Herdr World plugin, if installed from GitHub, reinstalled at
this release's tag. --install also installs Herdr when none is found.
`;
}

export interface HerdrCommandDeps {
  loadConfig?: typeof loadServerConfig;
  detect?: () => Promise<HerdrSetupState>;
  setup?: () => Promise<HerdrSetupResult>;
  upgrade?: (
    options: Pick<
      HerdrUpgradeDeps,
      "installMissing" | "integrations" | "plugin"
    >,
  ) => Promise<HerdrUpgradeReport>;
  serviceStatus?: () => { installed: boolean; active: boolean };
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const UPGRADE_FLAGS = [
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
          `Run \`herdr-world herdr setup\` to install the verified Herdr ${VERIFIED_HERDR_VERSION} and start it.`,
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
        integrations: !flags.includes("--no-integrations"),
        plugin: !flags.includes("--no-plugin"),
      });
      if (flags.includes("--json")) log(JSON.stringify(report));
      else for (const line of describeHerdrUpgrade(report)) log(line);
      return failedHerdrSteps(report).length ? 1 : 0;
    }

    const setup = dependencies.setup ?? (() => setupHerdr({ guard, ping }));
    const result = await setup();
    if (result.outcome === "already-running") {
      log(
        `Herdr is already running (version ${result.version}, protocol ${result.protocol}).`,
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
