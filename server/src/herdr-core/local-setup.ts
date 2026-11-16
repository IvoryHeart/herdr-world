// `herdr-world herdr setup` and `herdr upgrade --install` on this computer
// when no Herdr is found: the CLI form of the installers' core-first choice.
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import {
  coreInstallInput,
  PROBE_TIMEOUT_MS,
  parseCoreProbe,
  plainError,
  type Run,
  runProcess,
  SETUP_TIMEOUT_MS,
} from "./install";

export type LocalCoreSetup =
  /** An installed core, left exactly as it is. */
  | { outcome: "kept"; core: string }
  /** Core installed when missing, then started now and at login. */
  | { outcome: "set-up"; core: string; installed: boolean }
  /** Windows with no core: World sets up the Herdr TUI (see setupLocalCore). */
  | { outcome: "herdr"; core: null }
  | { outcome: "failed"; core: string | null; error: string };

export type LocalCoreSetupOptions = {
  /**
   * `herdr setup`: an installed core is started now and at login (nothing is
   * installed or replaced). `upgrade --install` leaves an installed core alone.
   */
  setUp: boolean;
  log: (line: string) => void;
  platform?: NodeJS.Platform;
  run?: Run;
  /** Windows: the installed herdr-core, if any. */
  findWindowsCore?: () => string | null;
};

const CORE_VERSION = /^hc [0-9]/;

/**
 * Finds herdr-core on this Windows computer where core's own PowerShell
 * installer puts it (HC_INSTALL_DIR, else %LOCALAPPDATA%\Programs\herdr-core),
 * herdr-core on PATH, or an `hc` that says it is core. Reads only.
 */
export function findWindowsCore(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  which: (name: string) => string | null = (name) => Bun.which(name),
  version: (path: string) => string = (path) => {
    try {
      const result = Bun.spawnSync([path, "--version"], { timeout: 5_000 });
      return result.stdout.toString().trim();
    } catch {
      return "";
    }
  },
): string | null {
  const dir =
    env.HC_INSTALL_DIR ||
    (env.LOCALAPPDATA
      ? win32.join(env.LOCALAPPDATA, "Programs", "herdr-core")
      : "");
  if (dir && exists(win32.join(dir, "herdr-core.exe")))
    return win32.join(dir, "herdr-core.exe");
  const core = which("herdr-core");
  if (core) return core;
  const hc = which("hc");
  return hc && CORE_VERSION.test(version(hc)) ? hc : null;
}

/**
 * The core-first choice for this computer once no Herdr was found: an
 * installed herdr-core is kept (and with setUp, started now and at login);
 * otherwise core is installed with World's reviewed copy of its official
 * steps and started now and at login.
 *
 * Windows: an installed core is kept and nothing else is installed. With no
 * core, World sets up the Herdr TUI instead, because World on Windows cannot
 * connect to a core on the same computer (core serves a named pipe there and
 * World's local core connection reads a Unix socket), so a new core would
 * leave World with no runtime. Windows hosts reached over SSH do use core.
 */
export async function setupLocalCore(
  options: LocalCoreSetupOptions,
): Promise<LocalCoreSetup> {
  if ((options.platform ?? process.platform) === "win32") {
    const core = (options.findWindowsCore ?? findWindowsCore)();
    return core ? { outcome: "kept", core } : { outcome: "herdr", core: null };
  }
  const run = options.run ?? runProcess;
  let stdout = "";
  const probed = await run(
    ["sh", "-s"],
    coreInstallInput("probe"),
    PROBE_TIMEOUT_MS,
    (line) => {
      stdout += `${line}\n`;
    },
  );
  if (probed.code !== 0)
    return {
      outcome: "failed",
      core: null,
      error: plainError(probed.stderr, "could not check for herdr-core"),
    };
  const probe = parseCoreProbe(stdout);
  if (probe.core && !options.setUp)
    return { outcome: "kept", core: probe.core };
  if (!probe.core && !probe.target)
    return {
      outcome: "failed",
      core: null,
      error: "herdr-core has no build for this computer",
    };
  // The setup step installs nothing when a core is there.
  const result = await run(
    ["sh", "-s"],
    coreInstallInput("setup"),
    SETUP_TIMEOUT_MS,
    options.log,
  );
  if (result.code !== 0)
    return {
      outcome: "failed",
      core: probe.core,
      error: plainError(
        result.stderr,
        probe.core
          ? "herdr-core could not be started"
          : "herdr-core could not be installed",
      ),
    };
  return {
    outcome: "set-up",
    core: probe.core ?? `${probe.dir}/herdr-core`,
    installed: !probe.core,
  };
}
