import packageJson from "../../package.json";
import { currentBuildVersion } from "../../scripts/build-version";
import { cliCommands, runCli, topLevelHelp } from "./cli";
import { CONTINUE_TO_SERVER, defaultCliContext } from "./cli/command";
import {
  isShortAuthPassword,
  RECOMMENDED_PASSWORD_LENGTH,
} from "./config/auth-token";
import { resolveDataPaths } from "./config/data-paths";
import { runPluginCommand } from "./config/plugin-command";
import {
  browserUrlFor,
  getLanIPs,
  isAnyHost,
  loadServerConfig,
  openBrowser,
  withLoginToken,
} from "./config/server-config";
import { sanitizeConnectionError } from "./connections/manager";
import { createShutdownController } from "./connections/shutdown";
import { describeListenerStartError } from "./connections/startup";
import { runAgentCheckoutCommand } from "./herdr/agent-checkout";
import { runTaskSummaryCommand } from "./herdr/task-summary";
import { herdrAdapter, systemClock, systemScheduler } from "./service/ports";
import { openStorage } from "./service/storage";
import { createWorldService, type WorldService } from "./service/world-service";
import { configureServerLogger, serverLogger } from "./utils/logger";

// The process: commands, configuration, signals and exit. The World service
// itself is built by its composition root (service/world-service.ts).
const APP_VERSION = currentBuildVersion(
  process.env.HERDR_WORLD_BUILD_VERSION,
  packageJson.version,
);
const pluginCommandResult = await runPluginCommand(
  process.argv.slice(2),
  APP_VERSION,
);
if (pluginCommandResult !== null) process.exit(pluginCommandResult);
const taskSummaryCommandResult = await runTaskSummaryCommand(
  process.argv.slice(2),
  APP_VERSION,
);
const agentCheckoutCommandResult = await runAgentCheckoutCommand(
  process.argv.slice(2),
  APP_VERSION,
);
if (agentCheckoutCommandResult !== null)
  process.exit(agentCheckoutCommandResult);
if (taskSummaryCommandResult !== null) {
  process.exit(taskSummaryCommandResult);
}
const cliCommandList = cliCommands();
const cliResult = await runCli(
  process.argv.slice(2),
  defaultCliContext(APP_VERSION),
  cliCommandList,
);
if (cliResult === CONTINUE_TO_SERVER) {
  // `service run <env>` loaded the service environment; start the listener.
  process.argv.splice(2);
} else if (cliResult !== null) {
  process.exit(cliResult);
}
const config = loadServerConfig(APP_VERSION, {
  helpText: () => topLevelHelp(cliCommandList),
});
configureServerLogger(config.logLevel);
const logger = serverLogger;
if (
  config.authRequired &&
  !config.generatedAuthToken &&
  isShortAuthPassword(config.password)
) {
  logger.warn(
    `The login password is shorter than ${RECOMMENDED_PASSWORD_LENGTH} characters. Use a longer one if this server is reachable beyond a trusted private network.`,
  );
}
if (config.authRequired && config.pin) {
  logger.warn(
    "PIN login is enabled. Use only behind a trusted private network or VPN; keep your password/token available for recovery.",
  );
}
const cpuProfile = config.profile
  ? (await import("./utils/cpu-profile")).startCpuProfile(
      config.profile,
      APP_VERSION,
      logger,
    )
  : undefined;

// Only a listener owns its data folder (instance-lock.ts) and may rotate
// sessions. Management commands also read ServerConfig, sometimes with a
// different environment from the running service.
let service: WorldService;
try {
  service = await createWorldService({
    config,
    paths: resolveDataPaths(),
    clock: systemClock,
    scheduler: systemScheduler,
    storage: openStorage,
    adapters: { herdr: herdrAdapter },
    scheduleProcessExit: scheduleManagedShutdown,
  });
} catch (cause) {
  console.error(`[bridge] FATAL: ${(cause as Error).message}`);
  process.exit(1);
}

let stopTask: Promise<void> | null = null;
function stopOnce(): Promise<void> {
  // The port stays bound until exit: a launchd restart waits for it to free
  // before starting the next process (service-manager.ts).
  stopTask ??= Promise.all([
    service.stop({ keepListener: true }),
    cpuProfile?.stop(),
  ]).then(() => {});
  return stopTask;
}

const shutdownController = createShutdownController({
  stop: stopOnce,
  exit: (code) => process.exit(code),
  onStopError: (error) => {
    logger.error("connection shutdown failed", {
      error: sanitizeConnectionError(error),
    });
  },
});

function scheduleManagedShutdown(): void {
  const timer = setTimeout(() => {
    void shutdownController.request(0);
  }, 1_000);
  timer.unref();
}

process.on("exit", () => {
  void stopOnce();
  // A forced exit can come before stop finishes; never leave the lock behind.
  service.releaseDataFolder();
});
process.on("SIGINT", () => {
  void shutdownController.request(130);
});
process.on("SIGTERM", () => {
  void shutdownController.request(143);
});

function main() {
  const { port: listeningPort } = service.start();
  const publicBrowserUrl = browserUrlFor(
    config.host,
    listeningPort,
    Boolean(config.tls),
  );
  logger.info("listening", {
    url: publicBrowserUrl,
    websocket: "/ws",
    log_level: config.logLevel,
  });
  if (config.authRequired) {
    if (config.generatedAuthTokenPath) {
      logger.info("authentication required", {
        mode: "generated token",
        path: config.generatedAuthTokenPath,
      });
    } else {
      logger.info("authentication required", { mode: "password" });
    }
  }
  logger.debug("Herdr sockets configured", {
    control_socket: config.socketPath,
    client_socket: config.clientSocketPath,
    public_dir: config.publicDir,
  });
  logger.info("browser URL", { url: publicBrowserUrl });

  const browserUrl = withLoginToken(
    publicBrowserUrl,
    config.generatedAuthToken,
  );
  if (isAnyHost(config.host)) {
    const lanUrls = getLanIPs().map((ip) =>
      browserUrlFor(ip, listeningPort, Boolean(config.tls)),
    );
    if (lanUrls.length > 0) {
      for (const url of lanUrls) logger.info("LAN URL", { url });
    } else {
      logger.warn("no LAN IPv4 address detected");
    }
  }
  openBrowser(config, browserUrl);
}

try {
  main();
} catch (e) {
  logger.error("fatal startup error", {
    error: describeListenerStartError(e, config.host, config.port),
  });
  void shutdownController.request(1);
}
