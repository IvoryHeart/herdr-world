import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * World's private data folder. `HERDR_WORLD_DATA_DIR` gives an instance its
 * own folder; one listener owns a folder at a time (instance-lock.ts).
 */
export function dataRoot(
  homeDir = homedir(),
  platform: string = process.platform,
  appDataDir = process.env.APPDATA,
  environment: Record<string, string | undefined> = process.env,
): string {
  // Read directly: the plugin launcher copies this file without its imports.
  const override = environment.HERDR_WORLD_DATA_DIR;
  if (override) return resolve(override);
  return join(
    platform === "win32"
      ? (appDataDir ?? join(homeDir, "AppData", "Roaming"))
      : join(homeDir, ".config"),
    "herdr-world",
  );
}

/** Every file one World service keeps in its data folder. */
export type DataPaths = {
  /** The folder itself: instance lock, signing secret, source secrets. */
  root: string;
  settings: string;
  connections: string;
  board: string;
  ledger: string;
  agentProfiles: string;
  webPush: string;
  sourceSecrets: string;
  sessionSecret: string;
  /** Ranger's folder. */
  assistant: string;
};

/**
 * Resolve the data folder and its per-file overrides once, for the listener's
 * composition root. The service never reads the environment for a data path.
 */
export function resolveDataPaths(
  environment: Record<string, string | undefined> = process.env,
  homeDir = homedir(),
  platform: string = process.platform,
): DataPaths {
  const root = dataRoot(homeDir, platform, environment.APPDATA, environment);
  // Read directly, as dataRoot does: an empty value is still an override.
  const override = (name: string) => environment[`HERDR_WORLD_${name}`];
  const settings = override("SETTINGS_PATH");
  return {
    root,
    settings: settings ?? join(root, "settings.json"),
    connections: override("CONNECTIONS_PATH") ?? join(root, "connections.json"),
    board: override("BOARD_PATH") ?? join(root, "boards", "board.json"),
    ledger:
      override("LEDGER_PATH") ?? join(root, "boards", "world-ledger.json"),
    agentProfiles:
      override("AGENT_PROFILES_PATH") ?? join(root, "agent-profiles.json"),
    webPush: override("WEB_PUSH_PATH") ?? join(root, "web-push.json"),
    // Each settings file names an instance; its secrets stay with it.
    sourceSecrets: resolve(
      join(
        root,
        settings
          ? `source-secrets-${createHash("sha256").update(resolve(settings)).digest("hex")}.json`
          : "source-secrets.json",
      ),
    ),
    sessionSecret: resolve(join(root, "session-secret.json")),
    assistant: override("ASSISTANT_DIR") ?? join(root, "assistant"),
  };
}

function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function statFollowingIfPresent(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// The platform configuration directories belong to the user, not Roamgate.
// Dotfile managers and folder redirection commonly make them symlinks or
// junctions, so they are followed; links inside Roamgate's tree never are.
function userConfigRoots(): Set<string> {
  return new Set(
    [dirname(dataRoot()), join(homedir(), ".config")].map((root) =>
      resolve(root),
    ),
  );
}

// Check the configuration parent, product directory and file; never follow a
// symlink, including dangling links.
export function assertSafeDataPath(path: string): void {
  const configRoots = userConfigRoots();
  for (const entry of [dirname(dirname(path)), dirname(path), path]) {
    const stat = configRoots.has(resolve(entry))
      ? statFollowingIfPresent(entry)
      : statIfPresent(entry);
    if (stat?.isSymbolicLink())
      throw new Error(`data path contains a symlink: ${entry}`);
    if (stat && (entry === path ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`data path has an unexpected file type: ${entry}`);
    }
  }
}

/**
 * Write a complete private file through a synced temporary file. Publishing
 * links it and keeps a concurrent winner; replacing renames over the target.
 */
function writeDataFile(
  path: string,
  contents: string | Buffer,
  mode: number,
  replace: boolean,
): void {
  assertSafeDataPath(path);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.herdr-world-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeFileSync(fd, contents);
    fchmodSync(fd, mode);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    assertSafeDataPath(path);
    if (replace) {
      renameSync(temporaryPath, path);
    } else {
      try {
        linkSync(temporaryPath, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        assertSafeDataPath(path);
      }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporaryPath, { force: true });
  }
  // Persist the new directory entry too. Windows cannot open directories, and
  // some filesystems reject directory fsync; the file itself is already synced.
  if (process.platform === "win32") return;
  try {
    const directoryFd = openSync(
      directory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
    );
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch {
    // Best effort, as for the connection registry.
  }
}

/** Publish a complete private file without replacing a concurrent winner. */
export function publishDataFile(
  path: string,
  contents: string | Buffer,
  mode = 0o600,
): void {
  writeDataFile(path, contents, mode, false);
}

/** Atomically replace a private file, unlike publishDataFile which never overwrites. */
export function replaceDataFile(
  path: string,
  contents: string | Buffer,
  mode = 0o600,
): void {
  writeDataFile(path, contents, mode, true);
}

export function defaultDataFile(
  name: "auth-token" | "settings.json" | "connections.json",
  homeDir = homedir(),
  platform: string = process.platform,
  appDataDir = process.env.APPDATA,
  environment: Record<string, string | undefined> = process.env,
): string {
  return join(dataRoot(homeDir, platform, appDataDir, environment), name);
}
