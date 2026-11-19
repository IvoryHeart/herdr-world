import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { findHerdrBinary } from "../herdr/bootstrap";
import { CORE_LOCK_FILE, defaultCoreStateDir } from "../herdr-core/endpoint";
import type { CoreConnectionProfile } from "./profiles";

export type LocalDiscoveryOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string;
};

/** Read-only binary discovery, including installations outside the service PATH. */
export function hasLocalTui(options: LocalDiscoveryOptions = {}): boolean {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  return Boolean(
    findHerdrBinary({
      platform,
      homeDir: home,
      pathEnv: env.PATH ?? "",
      binPathEnv: env.HERDR_BIN_PATH ?? "",
      installDir: env.HERDR_INSTALL_DIR,
      appDataDir: env.APPDATA,
      localAppDataDir: env.LOCALAPPDATA,
    }),
  );
}

/** Presence only: endpoint ownership and liveness are checked by the core transport. */
export function discoverLocalCoreConnection(
  options: LocalDiscoveryOptions = {},
): CoreConnectionProfile | null {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const session = env.HC_SESSION || "default";
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(session)) return null;
  const state =
    platform === "win32"
      ? join(
          env.XDG_STATE_HOME ||
            env.LOCALAPPDATA ||
            join(home, "AppData", "Local"),
          "herdr-core",
          session,
        )
      : defaultCoreStateDir(session, env, home);
  const executable = platform === "win32" ? "herdr-core.exe" : "herdr-core";
  const installDir =
    env.HC_INSTALL_DIR ||
    (platform === "win32"
      ? join(
          env.LOCALAPPDATA || join(home, "AppData", "Local"),
          "Programs",
          "herdr-core",
        )
      : join(home, ".local", "bin"));
  const candidates = [
    join(state, CORE_LOCK_FILE),
    join(installDir, executable),
    ...(env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, executable)),
  ];
  if (!candidates.some((path) => existsSync(path))) return null;
  return {
    id: "core-local",
    label: "herdr-core on this computer",
    type: "local",
    runtime: "herdr-core",
    core_session: session,
    core_state_dir: "",
    auto_connect: true,
  };
}
