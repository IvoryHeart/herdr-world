import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { dataRoot } from "../config/data-paths";
import { worldEnv } from "../config/environment";
import { fileVault } from "../integrations/vault";

/**
 * Source credentials (a Jira API token) live in World's vault, apart from
 * settings.json, which the settings UI reads back. They never leave the
 * service: the browser only learns whether a token is set.
 */

export type SourceSecrets = { jiraToken?: string };

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
  const jiraToken = fileVault(path).get("jira.token");
  return jiraToken ? { jiraToken } : {};
}

export function writeSourceSecrets(
  secrets: SourceSecrets,
  path = sourceSecretsPath(),
): void {
  fileVault(path).set("jira.token", secrets.jiraToken);
}
