import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { worldEnv } from "../config/environment";
import { getLanIPs, isAnyHost } from "../config/server-config";
import {
  loadConnectionProfileBootstrap,
  testConnectionSockets,
} from "../connections/profile-service";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import { ConnectionProfileStore } from "../connections/profiles";
import { herdrServiceStatus } from "../herdr/service";
import {
  compareVersion,
  fetchLatestUpdateManifest,
  normalizeUpdateBaseUrl,
  resolveUpdateTarget,
} from "../http/update";
import {
  assertValidPushSubject,
  readPushRegistry,
  webPushPath,
  webPushSubject,
} from "../notifications/web-push";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import {
  type CliCommand,
  type CliContext,
  displayPath,
  EXIT_FAILURE,
  EXIT_OK,
  isStandaloneBinary,
  parseCommandArgs,
  printJson,
  wantsHelp,
} from "./command";
import {
  accessUrls,
  type ListenerProbe,
  probeListener,
  probeUrl,
  readServiceAccess,
  readServiceSetup,
  type ServiceAccessInfo,
  type ServiceSetup,
  serviceHerdrSockets,
  serviceStatus,
  connectionRegistryPath,
  runtimeDataRoot,
} from "./service-context";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorDependencies {
  probe?: ListenerProbe;
  portInUse?: (host: string, port: number) => boolean;
  testSockets?: typeof testConnectionSockets;
  herdrService?: () => { installed: boolean; active: boolean };
  latestVersion?: (
    context: CliContext,
    env: Record<string, string>,
  ) => Promise<string | null>;
  lanIPs?: () => string[];
  now?: () => Date;
}

const CERT_WARNING_DAYS = 14;

function doctorHelp(): string {
  return `Check the Herdr World installation and report problems with fixes.

Usage:
  herdr-world doctor [--offline] [--json]

Options:
  --offline   skip the release update check
  --json      print machine-readable results

Checks the service configuration, credentials, TLS certificate, user service,
listener, network exposure, local Herdr server, saved connections, Web Push
registry and available updates. Exits 1 when any check fails. Include the
output (it contains no secrets) when reporting an issue.
`;
}

/** Bind and release the address to learn whether another process holds it. */
export function defaultPortInUse(host: string, port: number): boolean {
  try {
    const listener = Bun.listen({
      hostname: host,
      port,
      exclusive: true,
      socket: { data() {} },
    });
    listener.stop(true);
    return false;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | null)?.code;
    return (
      code === "EADDRINUSE" ||
      /port .* in use|address already in use/i.test(
        String((cause as Error)?.message),
      )
    );
  }
}

async function defaultLatestVersion(
  context: CliContext,
  env: Record<string, string>,
): Promise<string | null> {
  const target = resolveUpdateTarget(
    context.runtime.platform,
    context.runtime.arch,
  );
  if (!target) return null;
  const manifest = await fetchLatestUpdateManifest({
    baseUrl: normalizeUpdateBaseUrl(
      worldEnv("UPDATE_BASE_URL", context.runtime.env) ??
        worldEnv("UPDATE_BASE_URL", env),
    ),
    target,
    runProcessWithCodeTimeout,
  });
  return manifest.version;
}

function certificateCheck(path: string, now: Date): Check {
  try {
    const certificate = new X509Certificate(readFileSync(path));
    const expires = new Date(certificate.validTo);
    const days = Math.floor((expires.getTime() - now.getTime()) / 86_400_000);
    const subject = certificate.subject.replace(/\n/g, ", ");
    if (days < 0)
      return {
        name: "TLS certificate",
        status: "fail",
        detail: `expired on ${expires.toISOString().slice(0, 10)} (${subject})`,
        hint: "Renew the certificate, then run `herdr-world service restart`.",
      };
    return {
      name: "TLS certificate",
      status: days < CERT_WARNING_DAYS ? "warn" : "ok",
      detail: `valid until ${expires.toISOString().slice(0, 10)}, ${days} days left (${subject})`,
      hint:
        days < CERT_WARNING_DAYS ? "Renew the certificate soon." : undefined,
    };
  } catch (error) {
    return {
      name: "TLS certificate",
      status: "fail",
      detail: `cannot read ${path}: ${(error as Error).message}`,
    };
  }
}

function serviceChecks(context: CliContext): Check[] {
  const checks: Check[] = [];
  const status = serviceStatus(context);
  checks.push(
    !status.installed
      ? {
          name: "Service",
          status: "warn",
          detail: "not installed",
          hint: "Run `herdr-world service install` to start Herdr World at login.",
        }
      : status.active
        ? {
            name: "Service",
            status: "ok",
            detail: `installed and running (${displayPath(status.definition, context.runtime)})`,
          }
        : {
            name: "Service",
            status: "fail",
            detail: "installed but not running",
            hint: "Run `herdr-world service logs` to see why, then `herdr-world service restart`.",
          },
  );
  return checks;
}

async function listenerCheck(
  context: CliContext,
  access: ServiceAccessInfo,
  serviceActive: boolean,
  dependencies: Required<Pick<DoctorDependencies, "probe" | "portInUse">>,
): Promise<Check> {
  const url = probeUrl(access).replace(/\/healthz$/, "");
  if (await dependencies.probe(access))
    return {
      name: "Listener",
      status: "ok",
      detail: `Herdr World answers at ${url}`,
    };
  if (dependencies.portInUse(access.host, access.port))
    return {
      name: "Listener",
      status: "fail",
      detail: `port ${access.port} is held by a process that is not answering as Herdr World`,
      hint: "Stop the other process, or choose another port with `herdr-world config set PORT=<n> --restart`.",
    };
  return serviceActive
    ? {
        name: "Listener",
        status: "fail",
        detail: `the service runs but nothing answers at ${url}`,
        hint: "Run `herdr-world service logs` to see why.",
      }
    : {
        name: "Listener",
        status: "warn",
        detail: `nothing answers at ${url}`,
        hint: "Start it with `herdr-world service install`, or run `herdr-world`.",
      };
}

function networkCheck(
  access: ServiceAccessInfo,
  lanIPs: () => string[],
): Check {
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(access.host);
  if (loopback)
    return {
      name: "Network",
      status: "ok",
      detail: `only this machine can connect (HOST=${access.host})`,
    };
  const origins = accessUrls(
    { ...access, token: undefined, auth: "password" },
    lanIPs,
  );
  const reachable = isAnyHost(access.host) ? origins.lan : [origins.local];
  const transport = access.tls
    ? "HTTPS"
    : "plain HTTP; use a trusted private network or VPN";
  const parts: string[] = [
    `listening on ${access.host}:${access.port}, ${transport}`,
    ...(reachable.length ? [`reachable at ${reachable.join(", ")}`] : []),
  ];
  if (access.pinEnabled)
    return {
      name: "Network",
      status: "warn",
      detail: `${parts.join("; ")}; PIN login is enabled`,
      hint: "PIN login is meant for trusted private networks only.",
    };
  return { name: "Network", status: "ok", detail: parts.join("; ") };
}

async function herdrCheck(
  context: CliContext,
  setup: ServiceSetup,
  dependencies: Required<
    Pick<DoctorDependencies, "testSockets" | "herdrService">
  >,
): Promise<Check> {
  if (setup.env.HERDR_SSH_HOST)
    return {
      name: "Herdr",
      status: "skip",
      detail: `remote Herdr over SSH (${setup.env.HERDR_SSH_HOST})`,
      hint: "Run `herdr-world connections test` to check the SSH connection.",
    };
  let sockets = serviceHerdrSockets(context.runtime, setup.env);
  let savedLocal = false;
  try {
    const bootstrap = loadConnectionProfileBootstrap({
      store: new ConnectionProfileStore({
        path: connectionRegistryPath(context.runtime, setup.env),
      }),
      startupProfile: {
        id: STARTUP_DEFAULT_CONNECTION_ID,
        label: "Local",
        type: "local",
        control_socket_path: sockets.socketPath,
        client_socket_path: sockets.clientSocketPath,
        auto_connect: true,
      },
      explicitStartupOverride: Boolean(
        setup.env.HERDR_SOCKET_PATH ||
          setup.env.HERDR_CLIENT_SOCKET_PATH ||
          setup.env.HERDR_SSH_HOST ||
          setup.env.HERDR_SESSION,
      ),
    });
    const profile = bootstrap.registrations.find(
      ({ profile }) => profile.id === bootstrap.defaultConnectionId,
    )?.profile;
    if (profile?.type === "ssh")
      return {
        name: "Herdr",
        status: "skip",
        detail: `remote Herdr over SSH (${profile.ssh_destination})`,
        hint: "Run `herdr-world connections test` to check the SSH connection.",
      };
    if (profile?.type === "local") {
      sockets = {
        socketPath: profile.control_socket_path,
        clientSocketPath: profile.client_socket_path,
      };
      savedLocal =
        !bootstrap.explicitStartupOverride && !!bootstrap.persistedRegistry;
    }
  } catch {
    // Startup also falls back to legacy sockets; Connections reports the invalid registry.
  }

  let managed = "";
  try {
    const service = dependencies.herdrService();
    managed = service.installed
      ? `; managed Herdr service ${service.active ? "running" : "not running"}`
      : "";
  } catch {
    // Service state is supplementary.
  }
  try {
    const result = await dependencies.testSockets(
      sockets.socketPath,
      sockets.clientSocketPath,
    );
    return {
      name: "Herdr",
      status: "ok",
      detail: `Herdr ${result.version ?? "(unknown version)"}, protocol ${result.protocol}${managed}`,
    };
  } catch (error) {
    const explicit =
      setup.env.HERDR_SOCKET_PATH || setup.env.HERDR_CLIENT_SOCKET_PATH;
    return {
      name: "Herdr",
      status: "fail",
      detail: `cannot reach ${sockets.socketPath}: ${(error as Error).message}${managed}`,
      hint: savedLocal
        ? "Run `herdr-world connections test` to check the saved local connection."
        : explicit
          ? "Check HERDR_SOCKET_PATH and HERDR_CLIENT_SOCKET_PATH with `herdr-world config show`."
          : "Run `herdr-world herdr setup` to install and start Herdr.",
    };
  }
}

function connectionsCheck(context: CliContext, setup: ServiceSetup): Check {
  try {
    const store = new ConnectionProfileStore({
      path: connectionRegistryPath(context.runtime, setup.env),
    });
    const registry = store.load();
    return {
      name: "Connections",
      status: "ok",
      detail: registry
        ? `${registry.profiles.length} saved profile${registry.profiles.length === 1 ? "" : "s"}, default ${registry.default_connection_id}`
        : "default local connection only",
    };
  } catch (error) {
    return {
      name: "Connections",
      status: "fail",
      detail: `invalid registry: ${(error as Error).message}`,
      hint: "Herdr World preserves the file and disables profile edits until it is fixed.",
    };
  }
}

function pushCheck(context: CliContext, setup: ServiceSetup): Check {
  const subject = webPushSubject(setup.env);
  if (!subject)
    return {
      name: "Web Push",
      status: "skip",
      detail: "disabled (HERDR_WORLD_WEB_PUSH_SUBJECT is empty)",
    };
  try {
    assertValidPushSubject(subject);
  } catch {
    return {
      name: "Web Push",
      status: "fail",
      detail: `invalid HERDR_WORLD_WEB_PUSH_SUBJECT: ${subject}`,
      hint: "Use a mailto: address or an HTTPS URL.",
    };
  }
  const path = webPushPath(setup.env, runtimeDataRoot(context.runtime));
  if (!existsSync(path))
    return {
      name: "Web Push",
      status: "ok",
      detail: "no devices enrolled yet",
    };
  try {
    const devices = readPushRegistry(path).devices.length;
    return {
      name: "Web Push",
      status: "ok",
      detail: `${devices} device${devices === 1 ? "" : "s"} enrolled`,
      hint: devices
        ? "Run `herdr-world push test` to check delivery."
        : undefined,
    };
  } catch (error) {
    return {
      name: "Web Push",
      status: "fail",
      detail: `unusable registry ${path}: ${(error as Error).message}`,
      hint: "Herdr World preserves the file and disables push until it is restored.",
    };
  }
}

async function updateCheck(
  context: CliContext,
  setup: ServiceSetup | null,
  offline: boolean,
  latestVersion: NonNullable<DoctorDependencies["latestVersion"]>,
): Promise<Check> {
  if (offline)
    return { name: "Updates", status: "skip", detail: "skipped (--offline)" };
  const env = setup?.env ?? {};
  if (
    worldEnv("DISABLE_UPDATE_CHECK", context.runtime.env) === "1" ||
    worldEnv("DISABLE_UPDATE_CHECK", env) === "1"
  )
    return {
      name: "Updates",
      status: "skip",
      detail: "disabled by HERDR_WORLD_DISABLE_UPDATE_CHECK",
    };
  try {
    const latest = await latestVersion(context, env);
    if (latest === null)
      return {
        name: "Updates",
        status: "skip",
        detail: "no update package for this platform",
      };
    return compareVersion(latest, context.version) > 0
      ? {
          name: "Updates",
          status: "warn",
          detail: `herdr-world ${latest} is available`,
          hint: "Run `herdr-world update`.",
        }
      : { name: "Updates", status: "ok", detail: "up to date" };
  } catch (error) {
    return {
      name: "Updates",
      status: "warn",
      detail: `could not check: ${(error as Error).message.split("\n")[0]}`,
    };
  }
}

export async function runDoctorChecks(
  context: CliContext,
  options: { offline: boolean },
  dependencies: DoctorDependencies = {},
): Promise<Check[]> {
  const probe = dependencies.probe ?? probeListener;
  const portInUse = dependencies.portInUse ?? defaultPortInUse;
  const testSockets = dependencies.testSockets ?? testConnectionSockets;
  const herdrService =
    dependencies.herdrService ??
    (() =>
      herdrServiceStatus({
        homeDir: runtime.homeDir,
        appDataDir: runtime.appDataDir,
        uid: runtime.uid,
        runCommand: context.runCommand,
      }));
  const latestVersion = dependencies.latestVersion ?? defaultLatestVersion;
  const lanIPs = dependencies.lanIPs ?? getLanIPs;
  const now = dependencies.now ?? (() => new Date());
  const { runtime } = context;

  const checks: Check[] = [
    {
      name: "Herdr World",
      status: "ok",
      detail: `${context.version} on ${runtime.platform}-${runtime.arch}, ${
        isStandaloneBinary(runtime)
          ? displayPath(runtime.execPath, runtime)
          : "source checkout"
      }`,
    },
  ];

  let setup: ServiceSetup | null = null;
  try {
    setup = readServiceSetup(runtime);
  } catch (error) {
    checks.push({
      name: "Service config",
      status: "fail",
      detail: (error as Error).message,
    });
  }
  const update = updateCheck(context, setup, options.offline, latestVersion);
  if (!setup) {
    checks.push(await update);
    return checks;
  }

  let access: ServiceAccessInfo | null = null;
  try {
    access = readServiceAccess(setup);
    checks.push(
      setup.configExists
        ? {
            name: "Service config",
            status: "ok",
            detail: displayPath(setup.configPath, runtime),
          }
        : {
            name: "Service config",
            status: "warn",
            detail: `${displayPath(setup.configPath, runtime)} does not exist; defaults apply`,
            hint: "`herdr-world service install` creates it.",
          },
    );
  } catch (error) {
    checks.push({
      name: "Service config",
      status: "fail",
      detail: `${displayPath(setup.configPath, runtime)}: ${(error as Error).message}`,
      hint: "The service refuses to start; fix it with `herdr-world config edit`.",
    });
  }

  if (access) {
    checks.push(
      access.auth === "password"
        ? {
            name: "Login",
            status: "ok",
            detail: "fixed password from the service config",
          }
        : access.tokenError
          ? {
              name: "Login",
              status: "fail",
              detail: `invalid token file: ${access.tokenError}`,
              hint: "The service refuses to start; run `herdr-world auth rotate`.",
            }
          : access.token
            ? {
                name: "Login",
                status: "ok",
                detail: `generated token in ${displayPath(access.tokenPath, runtime)}`,
              }
            : {
                name: "Login",
                status: "warn",
                detail: "no login token yet",
                hint: "It is created by `herdr-world service install` or the first start.",
              },
    );
    const certificate = worldEnv("TLS_CERT", setup.env);
    if (access.tls && certificate)
      checks.push(certificateCheck(certificate, now()));
  }

  let serviceActive = false;
  try {
    const service = serviceChecks(context);
    serviceActive = service[0]?.status === "ok";
    checks.push(...service);
  } catch (error) {
    checks.push({
      name: "Service",
      status: "fail",
      detail: (error as Error).message,
    });
  }

  const [listener, herdr] = await Promise.all([
    access
      ? listenerCheck(context, access, serviceActive, { probe, portInUse })
      : null,
    herdrCheck(context, setup, { testSockets, herdrService }),
  ]);
  if (listener) checks.push(listener);
  if (access) checks.push(networkCheck(access, lanIPs));
  checks.push(
    herdr,
    connectionsCheck(context, setup),
    pushCheck(context, setup),
    await update,
  );
  return checks;
}

const STATUS_LABELS: Record<CheckStatus, string> = {
  ok: "ok  ",
  warn: "warn",
  fail: "FAIL",
  skip: "skip",
};

export function createDoctorCommand(
  dependencies: DoctorDependencies = {},
): CliCommand {
  return {
    name: "doctor",
    summary: "diagnose the installation and suggest fixes",
    flags: ["--offline", "--json"],
    help: doctorHelp,
    async run(args, context) {
      if (wantsHelp(args)) {
        context.log(doctorHelp());
        return EXIT_OK;
      }
      const { values } = parseCommandArgs(args, {
        offline: { type: "boolean" },
        json: { type: "boolean" },
      });
      const checks = await runDoctorChecks(
        context,
        { offline: values.offline === true },
        dependencies,
      );
      const failed = checks.some((check) => check.status === "fail");
      if (values.json) {
        printJson(context, { version: context.version, ok: !failed, checks });
        return failed ? EXIT_FAILURE : EXIT_OK;
      }
      const width = Math.max(...checks.map((check) => check.name.length));
      for (const check of checks) {
        context.log(
          `${STATUS_LABELS[check.status]}  ${check.name.padEnd(width)}  ${check.detail}`,
        );
        if (check.hint && check.status !== "ok")
          context.log(`${" ".repeat(width + 8)}${check.hint}`);
      }
      const count = (status: CheckStatus) =>
        checks.filter((check) => check.status === status).length;
      context.log("");
      context.log(
        `${count("ok")} ok, ${count("warn")} warning${count("warn") === 1 ? "" : "s"}, ${count("fail")} failure${count("fail") === 1 ? "" : "s"}`,
      );
      return failed ? EXIT_FAILURE : EXIT_OK;
    },
  };
}
