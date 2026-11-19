import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import type { VaultStatus } from "../../../shared/integrations";
import { assertSafeDataPath, replaceDataFile } from "../config/data-paths";

/**
 * The one place World keeps the tokens integrations need. Values stay in the
 * service: callers outside it learn only which names are set.
 *
 * The backend is a private file in World's data folder: owner-only (0600),
 * no symlinks or hard links, written atomically. A file with wider modes is
 * narrowed back to 0600 when read. An OS keychain backend can implement the
 * same interface later; World runs headless as a user service, where a
 * keychain prompt has nobody to answer it.
 */

export type VaultSecretName = keyof typeof VAULT_SECRETS;

/** Every secret World may keep, with the integration that uses it. */
export const VAULT_SECRETS = {
  "jira.token": { label: "Jira API token", usedBy: "source:jira" },
} as const;

export interface Vault {
  get(name: VaultSecretName): string | undefined;
  /** Store a value, or remove it with `undefined` or an empty string. */
  set(name: VaultSecretName, value: string | undefined): void;
  status(): VaultStatus;
}

const MAX_BYTES = 8 * 1024;
const VERSION = 2;

function isSecretName(name: string): name is VaultSecretName {
  return Object.hasOwn(VAULT_SECRETS, name);
}

type Values = Partial<Record<VaultSecretName, string>>;

/** Parse either format: v2 `{secrets:{name:value}}` or v1 `{jira_token}`. */
function parseValues(value: unknown): Values {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state = value as Record<string, unknown>;
  const values: Values = {};
  const stored = state.secrets;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [name, secret] of Object.entries(stored)) {
      if (isSecretName(name) && typeof secret === "string" && secret)
        values[name] = secret;
    }
  }
  if (
    !values["jira.token"] &&
    typeof state.jira_token === "string" &&
    state.jira_token
  )
    values["jira.token"] = state.jira_token;
  return values;
}

function readValues(path: string): Values {
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
      throw new Error(`Invalid World vault file: ${path}`);
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      fchmodSync(fd, 0o600);
    return parseValues(JSON.parse(readFileSync(fd, "utf8")));
  } finally {
    closeSync(fd);
  }
}

function writeValues(path: string, values: Values): void {
  const secrets: Values = {};
  for (const name of Object.keys(VAULT_SECRETS) as VaultSecretName[]) {
    if (values[name]) secrets[name] = values[name];
  }
  replaceDataFile(path, `${JSON.stringify({ version: VERSION, secrets })}\n`);
}

export function fileVault(
  path: string,
  options: { writable?: () => boolean } = {},
): Vault {
  return {
    get: (name) => readValues(path)[name],
    set: (name, value) => {
      if (options.writable && !options.writable())
        throw new Error("World storage is closed");
      let values: Values = {};
      try {
        values = readValues(path);
      } catch {
        // An unreadable file is replaced whole; the rename never follows it.
      }
      if (value) values[name] = value;
      else delete values[name];
      writeValues(path, values);
    },
    status: () => {
      let values: Values = {};
      let detail =
        "A private file in World's data folder that only your user can read.";
      try {
        values = readValues(path);
      } catch {
        detail = "World can't read its vault file; set the tokens again.";
      }
      return {
        backend: "file",
        label: "Private file",
        detail,
        secrets: (Object.keys(values) as VaultSecretName[]).map((name) => ({
          name,
          label: VAULT_SECRETS[name].label,
          usedBy: VAULT_SECRETS[name].usedBy,
        })),
      };
    },
  };
}
