import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function dataRoot(
  homeDir = homedir(),
  platform: string = process.platform,
  appDataDir = process.env.APPDATA,
): string {
  return join(
    platform === "win32"
      ? (appDataDir ?? join(homeDir, "AppData", "Roaming"))
      : join(homeDir, ".config"),
    "herdr-world",
  );
}

function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Check the configuration parent, product directory and file; never follow a
// symlink, including dangling links.
export function assertSafeDataPath(path: string): void {
  for (const entry of [dirname(dirname(path)), dirname(path), path]) {
    const stat = statIfPresent(entry);
    if (stat?.isSymbolicLink())
      throw new Error(`data path contains a symlink: ${entry}`);
    if (stat && (entry === path ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`data path has an unexpected file type: ${entry}`);
    }
  }
}

/** Publish a complete private file without replacing a concurrent winner. */
export function publishDataFile(
  path: string,
  contents: string | Buffer,
  mode = 0o600,
): void {
  assertSafeDataPath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = join(dirname(path), `.herdr-world-${randomUUID()}.tmp`);
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
    try {
      linkSync(temporaryPath, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      assertSafeDataPath(path);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporaryPath, { force: true });
  }
}

export function defaultDataFile(
  name: "auth-token" | "settings.json" | "connections.json",
  homeDir = homedir(),
  platform: string = process.platform,
  appDataDir = process.env.APPDATA,
): string {
  return join(dataRoot(homeDir, platform, appDataDir), name);
}
