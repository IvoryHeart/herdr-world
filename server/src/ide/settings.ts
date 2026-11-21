import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { replaceDataFile } from "../config/data-paths";
import { type IdeProviderId, isIdeProviderId } from "./providers";

/**
 * The owner's IDE choices for this World's own computer (`ide.json` in the
 * data folder): which installed provider is enabled, when its terms and the
 * full-access trust were accepted, and an optional program path per
 * provider, this World's random ID, which marks the IDE servers it
 * started on each host, and the servers it started that may still run, so
 * that none goes unseen after a restart even when its host is no longer one
 * of World's connections. Nothing here is a secret; tokens live only in the
 * private folder of a running server.
 */
export type IdeProviderSetting = {
  /** Enabled for opening projects. */
  enabled: boolean;
  /** ISO time the owner accepted the provider's upstream terms, if any. */
  terms_accepted_at?: string;
  /** ISO time the owner accepted full shell/write and same-origin trust. */
  trusted_at?: string;
  /** Absolute program path that overrides discovery. */
  binary?: string;
};

/**
 * One IDE server World started and hasn't seen stop: kept until Stop
 * succeeds, its host shows it is gone, or the person forgets one World
 * can no longer reach.
 */
export type IdeServerRecord = {
  id: string;
  provider: IdeProviderId;
  connection_id: string;
  /** The SSH destination it runs on; absent on World's own computer. */
  ssh_destination?: string;
  host_label: string;
  folder: string;
  started_at: string;
};

export type IdeSettings = {
  version: 1;
  providers: Partial<Record<IdeProviderId, IdeProviderSetting>>;
  /** Set when World first starts an IDE server; never changes after. */
  world_id?: string;
  servers?: IdeServerRecord[];
};

const WORLD_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SERVER_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PATH = 4096;
const MAX_TEXT = 1024;
const MAX_SERVERS = 256;

const line = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);

function parseServer(value: unknown): IdeServerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !SERVER_ID.test(record.id) ||
    !isIdeProviderId(record.provider) ||
    !line(record.connection_id) ||
    !line(record.host_label) ||
    !line(record.folder, MAX_PATH) ||
    !isAbsolute(record.folder) ||
    !line(record.started_at) ||
    (record.ssh_destination !== undefined && !line(record.ssh_destination))
  )
    return null;
  return {
    id: record.id,
    provider: record.provider,
    connection_id: record.connection_id,
    ...(typeof record.ssh_destination === "string"
      ? { ssh_destination: record.ssh_destination }
      : {}),
    host_label: record.host_label,
    folder: record.folder,
    started_at: record.started_at,
  };
}

const EMPTY: IdeSettings = { version: 1, providers: {} };

function parseSetting(value: unknown): IdeProviderSetting | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const setting: IdeProviderSetting = { enabled: record.enabled === true };
  for (const key of ["terms_accepted_at", "trusted_at"] as const) {
    const text = record[key];
    if (typeof text === "string" && !Number.isNaN(Date.parse(text)))
      setting[key] = text;
  }
  if (isValidBinaryPath(record.binary)) setting.binary = record.binary;
  // Enabled without recorded trust is not enabled: the gate comes first.
  if (setting.enabled && !setting.trusted_at) setting.enabled = false;
  return setting;
}

export function isValidBinaryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH &&
    isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function parseIdeSettings(text: string): IdeSettings {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (value?.version !== 1 || typeof value.providers !== "object")
      return structuredClone(EMPTY);
    const providers: IdeSettings["providers"] = {};
    for (const [id, entry] of Object.entries(
      value.providers as Record<string, unknown>,
    )) {
      if (!isIdeProviderId(id)) continue;
      const setting = parseSetting(entry);
      if (setting) providers[id] = setting;
    }
    const servers = Array.isArray(value.servers)
      ? value.servers
          .slice(0, MAX_SERVERS)
          .flatMap((entry) => parseServer(entry) ?? [])
      : [];
    return {
      version: 1,
      providers,
      ...(typeof value.world_id === "string" && WORLD_ID.test(value.world_id)
        ? { world_id: value.world_id }
        : {}),
      ...(servers.length ? { servers } : {}),
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export type IdeSettingsStore = {
  read(): IdeSettings;
  update(change: (current: IdeSettings) => IdeSettings): IdeSettings;
};

export function fileIdeSettingsStore(path: string): IdeSettingsStore {
  const read = (): IdeSettings => {
    try {
      return parseIdeSettings(readFileSync(path, "utf8"));
    } catch {
      return structuredClone(EMPTY);
    }
  };
  return {
    read,
    update(change) {
      const next = change(read());
      replaceDataFile(path, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    },
  };
}

export function memoryIdeSettingsStore(
  initial: IdeSettings = EMPTY,
): IdeSettingsStore {
  let current = structuredClone(initial);
  return {
    read: () => structuredClone(current),
    update(change) {
      current = structuredClone(change(structuredClone(current)));
      return structuredClone(current);
    },
  };
}
