import type { ServerConfig } from "../config/server-config";
import type { ConnectionProfile } from "../connections/profiles";
import {
  resolveHerdrReleaseTarget,
  VERIFIED_HERDR_VERSION,
} from "../herdr/release";
import {
  describeHerdrUpgrade,
  type HerdrUpgradeDeps,
  type HerdrUpgradePlan,
  type HerdrUpgradeReport,
  planHerdrUpgrade,
  upgradeHerdr,
} from "../herdr/upgrade";
import {
  assertManagedSetupAllowed,
  detectHerdrSetup,
  type HerdrBootstrapDeps,
  type HerdrSetupGuard,
  type HerdrSetupResult,
  type HerdrSetupState,
  setupHerdr,
} from "../herdr/bootstrap";

const HERDR_SETUP_CONFIRMATION_HEADER = "x-herdr-world-herdr-setup";
const HERDR_UPGRADE_CONFIRMATION_HEADER = "x-herdr-world-herdr-upgrade";

export function herdrSetupGuardForProfile(
  config: Pick<
    ServerConfig,
    | "sshHost"
    | "session"
    | "socketPath"
    | "clientSocketPath"
    | "hasExplicitSocketPath"
    | "hasExplicitClientSocketPath"
  >,
  profile: ConnectionProfile | undefined,
): HerdrSetupGuard {
  if (!profile) throw new Error("Default connection profile is unavailable.");
  return {
    sshHost: profile.type === "ssh" ? profile.ssh_destination : config.sshHost,
    session: config.session,
    hasExplicitSocketPath:
      config.hasExplicitSocketPath ||
      (profile.type === "local" &&
        profile.control_socket_path !== config.socketPath),
    hasExplicitClientSocketPath:
      config.hasExplicitClientSocketPath ||
      (profile.type === "local" &&
        profile.client_socket_path !== config.clientSocketPath),
  };
}

function herdrJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, headers });
}

function statePayload(state: HerdrSetupState): Record<string, unknown> {
  if (state.state === "running") {
    return {
      state: state.state,
      version: state.version,
      protocol: state.protocol,
    };
  }
  if (state.state === "installed") {
    return { state: state.state, binary_path: state.binaryPath };
  }
  return { state: state.state };
}

function resultPayload(result: HerdrSetupResult): Record<string, unknown> {
  return {
    ok: true,
    outcome: result.outcome,
    version: result.version,
    protocol: result.protocol,
    ...(result.outcome === "already-running"
      ? {}
      : { binary_path: result.binaryPath }),
  };
}

function upgradePayload(plan: HerdrUpgradePlan): Record<string, unknown> {
  return {
    state: plan.state,
    ...("version" in plan && plan.version ? { version: plan.version } : {}),
    ...(plan.state === "package-managed" ? { command: plan.command } : {}),
  };
}

export function createHerdrSetupHandlers({
  ping,
  guard,
  bootstrap = {},
  upgrade,
}: {
  ping: () => Promise<{ version: string; protocol: number }>;
  guard: () => HerdrSetupGuard;
  bootstrap?: Omit<HerdrBootstrapDeps, "guard" | "ping">;
  upgrade?: {
    worldVersion: string;
    /** The default connection's local Herdr server; undefined for SSH. */
    server: () => HerdrUpgradeDeps["server"];
    plan?: () => HerdrUpgradePlan;
    run?: (deps: HerdrUpgradeDeps) => Promise<HerdrUpgradeReport>;
  };
}) {
  let setupInProgress = false;

  async function handleHerdrStatus(): Promise<Response> {
    try {
      const target = guard();
      let canSetup = true;
      try {
        assertManagedSetupAllowed(target);
      } catch {
        canSetup = false;
      }
      const state = await detectHerdrSetup({
        ...bootstrap,
        guard: target,
        ping,
      });
      const hasRelease =
        resolveHerdrReleaseTarget(
          bootstrap.platform ?? process.platform,
          bootstrap.arch ?? process.arch,
        ) !== null;
      // The upgrade concerns the binary on this machine, so it is offered
      // only while the default connection is local.
      const upgradePlan =
        upgrade && !target.sshHost
          ? (upgrade.plan ?? (() => planHerdrUpgrade(bootstrap)))()
          : undefined;
      return herdrJson({
        ...statePayload(state),
        can_setup: canSetup && (state.state !== "missing" || hasRelease),
        verified_version: VERIFIED_HERDR_VERSION,
        ...(upgradePlan ? { upgrade: upgradePayload(upgradePlan) } : {}),
      });
    } catch (error) {
      return herdrJson({ error: (error as Error).message }, { status: 500 });
    }
  }

  async function handleHerdrSetup(req: Request): Promise<Response> {
    if (req.headers.get(HERDR_SETUP_CONFIRMATION_HEADER) !== "1") {
      return herdrJson(
        { error: "Herdr setup confirmation header is required." },
        { status: 403 },
      );
    }
    if (setupInProgress) {
      return herdrJson(
        { error: "A Herdr setup is already in progress." },
        { status: 409 },
      );
    }
    setupInProgress = true;
    try {
      const result = await setupHerdr({ ...bootstrap, guard: guard(), ping });
      return herdrJson(resultPayload(result));
    } catch (error) {
      return herdrJson({ error: (error as Error).message }, { status: 500 });
    } finally {
      setupInProgress = false;
    }
  }

  // One upgrade at a time, reported through GET because a live handoff and a
  // plugin rebuild can outlast an HTTP request.
  let upgradeJob:
    | { status: "running" }
    | { status: "done"; report: HerdrUpgradeReport; lines: string[] }
    | { status: "failed"; error: string }
    | null = null;

  function handleHerdrUpgradeStatus(): Response {
    return herdrJson(upgradeJob ?? { status: "idle" });
  }

  function handleHerdrUpgrade(req: Request): Response {
    if (req.headers.get(HERDR_UPGRADE_CONFIRMATION_HEADER) !== "1") {
      return herdrJson(
        { error: "Herdr upgrade confirmation header is required." },
        { status: 403 },
      );
    }
    if (!upgrade) {
      return herdrJson(
        { error: "Herdr upgrade is unavailable." },
        { status: 404 },
      );
    }
    if (setupInProgress) {
      return herdrJson(
        { error: "A Herdr setup or upgrade is already in progress." },
        { status: 409 },
      );
    }
    if (guard().sshHost) {
      return herdrJson(
        {
          error:
            "Herdr upgrade applies to this machine's Herdr; the default connection is an SSH host.",
        },
        { status: 409 },
      );
    }
    setupInProgress = true;
    upgradeJob = { status: "running" };
    void (async () => {
      try {
        const report = await (upgrade.run ?? upgradeHerdr)({
          ...bootstrap,
          worldVersion: upgrade.worldVersion,
          server: upgrade.server(),
        });
        upgradeJob = {
          status: "done",
          report,
          lines: describeHerdrUpgrade(report),
        };
      } catch (error) {
        upgradeJob = { status: "failed", error: (error as Error).message };
      } finally {
        setupInProgress = false;
      }
    })();
    return herdrJson({ ok: true, status: "running" }, { status: 202 });
  }

  return {
    handleHerdrStatus,
    handleHerdrSetup,
    handleHerdrUpgrade,
    handleHerdrUpgradeStatus,
  };
}
