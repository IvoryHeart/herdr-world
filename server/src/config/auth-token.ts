import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  defaultDataFile,
  publishDataFile,
  replaceDataFile,
  assertSafeDataPath,
} from "./data-paths";
import { randomBytes } from "node:crypto";

const AUTH_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;
// Shorter passwords are accepted, but startup warns about them.
export const RECOMMENDED_PASSWORD_LENGTH = 15;

export function assertValidAuthPassword(password: string): void {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `Login password must contain at least ${MIN_PASSWORD_LENGTH} characters and at most ${MAX_PASSWORD_LENGTH} characters (--password or HERDR_WORLD_PASSWORD).`,
    );
  }
}

export function isShortAuthPassword(password: string): boolean {
  return Array.from(password).length < RECOMMENDED_PASSWORD_LENGTH;
}

export function assertValidAuthPin(pin: string): void {
  if (!/^[0-9]{6,12}$/.test(pin)) {
    throw new Error("HERDR_WORLD_PIN must contain 6 to 12 ASCII digits.");
  }
}

export function defaultAuthTokenPath(
  homeDir = homedir(),
  platform = process.platform,
  appDataDir = process.env.APPDATA,
): string {
  return defaultDataFile("auth-token", homeDir, platform, appDataDir);
}

function pathUnder(path: string, root: string | undefined): string | null {
  if (!root) return null;
  // Keep the separator boundary check even when the root already ends in one.
  const prefix = root.replace(/[\\/]+$/, "");
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  return /^[\\/]/.test(rest) ? rest.slice(1) : null;
}

/**
 * A host shell command that prints the generated token, for the login page.
 * It names the file relative to the home or APPDATA directory so the
 * unauthenticated page never reveals the account name.
 */
export function authTokenPrintCommand(
  path: string,
  homeDir = homedir(),
  platform = process.platform,
  appDataDir = process.env.APPDATA,
): string | undefined {
  if (platform === "win32") {
    const inAppData = pathUnder(path, appDataDir);
    const inHome = inAppData === null ? pathUnder(path, homeDir) : null;
    const rest = inAppData ?? inHome;
    if (rest === null || /["`$]/.test(rest)) return undefined;
    const root = inAppData === null ? "$HOME" : "$env:APPDATA";
    return `Get-Content "${root}\\${rest.replaceAll("/", "\\")}"`;
  }
  const rest = pathUnder(path, homeDir);
  if (rest === null || !/^[\w./-]+$/.test(rest)) return undefined;
  return `cat ~/${rest}`;
}

export function readAuthToken(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error(
        `generated auth token path is not a regular file: ${path}`,
      );
    }
    const token = readFileSync(fd, "utf8").trim();
    if (!AUTH_TOKEN_PATTERN.test(token)) {
      throw new Error(
        `invalid generated auth token in ${path}; restore a valid token or replace it with a fresh 64-character lowercase hexadecimal secret`,
      );
    }
    fchmodSync(fd, 0o600);
    return token;
  } finally {
    closeSync(fd);
  }
}

export function loadOrCreateAuthToken(path = defaultAuthTokenPath()): string {
  assertSafeDataPath(path);
  try {
    return readAuthToken(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  publishDataFile(path, `${randomBytes(32).toString("hex")}\n`);
  return readAuthToken(path);
}

/** Replace the generated token; running servers keep the old one until restart. */
export function rotateAuthToken(path = defaultAuthTokenPath()): string {
  assertSafeDataPath(path);
  replaceDataFile(path, `${randomBytes(32).toString("hex")}\n`);
  return readAuthToken(path);
}
