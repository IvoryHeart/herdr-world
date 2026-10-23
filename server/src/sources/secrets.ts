import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  assertSafeDataPath,
  dataRoot,
  replaceDataFile,
} from "../config/data-paths";
import { worldEnv } from "../config/environment";

/**
 * Source credentials (a Jira API token) live in their own private file, apart
 * from settings.json, which the settings UI reads back. They never leave the
 * service: the browser only learns whether a token is set.
 */

export type SourceSecrets = { jiraToken?: string };

const MAX_BYTES = 8 * 1024;

export function sourceSecretsPath(
  settingsPath = worldEnv("SETTINGS_PATH"),
  root = dataRoot(),
): string {
  // Each settings file names an instance; its secrets stay with it.
  const filename = settingsPath
    ? `source-secrets-${createHash("sha256").update(resolve(settingsPath)).digest("hex")}.json`
    : "source-secrets.json";
  return resolve(join(root, filename));
}

export function readSourceSecrets(path = sourceSecretsPath()): SourceSecrets {
  assertSafeDataPath(path);
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)
      throw new Error(`Invalid source credentials file: ${path}`);
    const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
    const state =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return typeof state.jira_token === "string" && state.jira_token
      ? { jiraToken: state.jira_token }
      : {};
  } finally {
    closeSync(fd);
  }
}

export function writeSourceSecrets(
  secrets: SourceSecrets,
  path = sourceSecretsPath(),
): void {
  replaceDataFile(
    path,
    `${JSON.stringify({
      version: 1,
      ...(secrets.jiraToken ? { jira_token: secrets.jiraToken } : {}),
    })}\n`,
  );
}
