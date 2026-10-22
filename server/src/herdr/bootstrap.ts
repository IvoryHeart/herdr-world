import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { HerdrClient } from "../bridge/herdr-client";
import { assertSupportedHerdrProtocol } from "../bridge/protocol-compat";
import {
  herdrDefaultBinaryPath,
  installVerifiedHerdr,
  legacyWindowsHerdrBinaryPath,
} from "./release";
import { installHerdrService } from "./service";

export type HerdrSetupState =
  | { state: "running"; version: string; protocol: number }
  | { state: "installed"; binaryPath: string }
  | { state: "missing" };

export type HerdrSetupResult =
  | { outcome: "already-running"; version: string; protocol: number }
  | {
      outcome: "started" | "installed-and-started";
      binaryPath: string;
      version: string;
      protocol: number;
    };

/** Settings that make a herdr-world-managed Herdr impossible or ambiguous. */
export interface HerdrSetupGuard {
  sshHost?: string;
  session?: string;
  hasExplicitSocketPath?: boolean;
  hasExplicitClientSocketPath?: boolean;
}

export interface HerdrBootstrapDeps {
  guard?: HerdrSetupGuard;
  platform?: string;
  arch?: string;
  homeDir?: string;
  appDataDir?: string;
  localAppDataDir?: string;
  /** HERDR_INSTALL_DIR. */
  installDir?: string;
  pathEnv?: string;
  /** HERDR_BIN_PATH, which Herdr sets for plugin processes. */
  binPathEnv?: string;
  ping?: () => Promise<{ version: string; protocol: number }>;
  installRelease?: () => Promise<{ binaryPath: string }>;
  installService?: (binaryPath: string) => void;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function assertManagedSetupAllowed(guard: HerdrSetupGuard = {}): void {
  if (guard.sshHost) {
    throw new Error(
      "managed Herdr setup is only available for the local Herdr server, not SSH connections",
    );
  }
  if (guard.session) {
    throw new Error(
      "managed Herdr setup only supports the default Herdr session; start `herdr server` yourself for a named session",
    );
  }
  if (guard.hasExplicitSocketPath || guard.hasExplicitClientSocketPath) {
    throw new Error(
      "managed Herdr setup only supports the default Herdr socket paths; start `herdr server` yourself with your custom paths",
    );
  }
}

export function findHerdrBinary(
  deps: Pick<
    HerdrBootstrapDeps,
    | "platform"
    | "homeDir"
    | "appDataDir"
    | "localAppDataDir"
    | "installDir"
    | "pathEnv"
    | "binPathEnv"
  > = {},
): string | null {
  const platform = deps.platform ?? process.platform;
  const executable = platform === "win32" ? "herdr.exe" : "herdr";

  // 1. The binary Herdr itself names for the processes it starts.
  const binPath = (deps.binPathEnv ?? process.env.HERDR_BIN_PATH)?.trim();
  if (binPath && isAbsolute(binPath) && existsSync(binPath)) return binPath;

  // 2. Whatever the user already has on PATH.
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? "";
  for (const directory of pathEnv.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }

  // 3. Herdr's default install location, which services may not have on
  //    PATH, then the directory older Herdr World releases used on Windows.
  const candidates = [herdrDefaultBinaryPath({ ...deps, platform })];
  if (platform === "win32")
    candidates.push(legacyWindowsHerdrBinaryPath({ ...deps, platform }));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function detectHerdrSetup(
  deps: HerdrBootstrapDeps = {},
): Promise<HerdrSetupState> {
  const ping = deps.ping ?? (() => new HerdrClient(defaultSocketPath()).ping());
  try {
    const info = await ping();
    if (
      info &&
      typeof info.version === "string" &&
      typeof info.protocol === "number"
    ) {
      return {
        state: "running",
        version: info.version,
        protocol: info.protocol,
      };
    }
  } catch {
    // Herdr is not reachable; fall through to binary detection.
  }
  const binaryPath = findHerdrBinary(deps);
  return binaryPath ? { state: "installed", binaryPath } : { state: "missing" };
}

function defaultSocketPath(): string {
  return join(homedir(), ".config", "herdr", "herdr.sock");
}

/**
 * Make the local Herdr server reachable: install the verified release when no
 * binary exists, then install and start the user service running
 * `herdr server`, and wait until the socket answers.
 */
export async function setupHerdr(
  deps: HerdrBootstrapDeps = {},
): Promise<HerdrSetupResult> {
  assertManagedSetupAllowed(deps.guard);
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ping = deps.ping ?? (() => new HerdrClient(defaultSocketPath()).ping());

  const state = await detectHerdrSetup({ ...deps, ping });
  if (state.state === "running") {
    return {
      outcome: "already-running",
      version: state.version,
      protocol: state.protocol,
    };
  }

  const binaryPath =
    state.state === "installed"
      ? state.binaryPath
      : (await (deps.installRelease ?? (() => installVerifiedHerdr(deps)))())
          .binaryPath;
  (
    deps.installService ??
    ((path) =>
      installHerdrService(path, {
        homeDir: deps.homeDir,
        appDataDir: deps.appDataDir,
      }))
  )(binaryPath);

  const timeoutMs = deps.startTimeoutMs ?? 15000;
  const intervalMs = deps.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;
  for (;;) {
    try {
      const info = await ping();
      assertSupportedHerdrProtocol(info?.protocol);
      return {
        outcome:
          state.state === "installed" ? "started" : "installed-and-started",
        binaryPath,
        version: info.version,
        protocol: info.protocol,
      };
    } catch (error) {
      lastError = error as Error;
      if (Date.now() >= deadline) break;
      await sleep(intervalMs);
    }
  }
  throw new Error(
    `Herdr service was installed but the server did not become reachable within ${Math.round(timeoutMs / 1000)}s: ${lastError?.message ?? "timeout"}`,
  );
}
