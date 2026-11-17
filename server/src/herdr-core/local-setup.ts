// `herdr-world herdr setup` and `herdr upgrade --install` on this computer
// when no Herdr is found: the CLI form of the installers' core-first choice.
import { win32 } from "node:path";
import {
  coreInstallInput,
  localInstallArgv,
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
};

/**
 * The core-first choice for this computer once no Herdr was found: an
 * installed herdr-core is kept (and with setUp, started now and at login);
 * otherwise core is installed with World's reviewed copy of its official
 * steps and started now and at login. Windows runs the PowerShell copy of
 * core's install.ps1 steps and starts core at login from the Startup folder;
 * World there reaches the core over its named pipe.
 */
export async function setupLocalCore(
  options: LocalCoreSetupOptions,
): Promise<LocalCoreSetup> {
  const platform = options.platform ?? process.platform;
  const argv = localInstallArgv(platform);
  const run = options.run ?? runProcess;
  let stdout = "";
  const probed = await run(
    argv,
    coreInstallInput("probe", null, "default", platform),
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
    argv,
    coreInstallInput("setup", null, "default", platform),
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
    core:
      probe.core ??
      (platform === "win32"
        ? win32.join(probe.dir, "herdr-core.exe")
        : `${probe.dir}/herdr-core`),
    installed: !probe.core,
  };
}
