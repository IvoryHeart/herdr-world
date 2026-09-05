import { apiErrorMessage, type BridgeHttpUrl } from "./bridgeApi";
import { fetchWithTimeout } from "./fetchWithTimeout";

export type RemoteAccessModel = {
  enabled: boolean;
  accepted_hosts: string[];
  allowed_page_origins: string[];
  allowed_bridge_origins: string[];
  password_configured: boolean;
};

export type RemoteAccessStatus = {
  remote_access: RemoteAccessModel;
  port: number;
  suggestions: string[];
  mutation_allowed: boolean;
  mutation_reason?: string | null;
  apply: RemoteAccessApplyStatus;
};

export type RemoteAccessApplyStatus = {
  id: string | null;
  state: "applying" | "ready" | "failed";
  reason?: string | null;
  restored?: boolean | null;
};

export type RemoteAccessDraft = Omit<RemoteAccessModel, "password_configured">;
export type RemotePasswordAction = "keep" | "set" | "remove";

const APPLY_TIMEOUT_MS = 20_000;
const APPLY_POLL_INTERVAL_MS = 500;

export async function fetchRemoteAccess(httpUrl: BridgeHttpUrl): Promise<RemoteAccessStatus> {
  const response = await fetchWithTimeout(httpUrl("/api/local/remote-access"));
  if (!response.ok) throw new Error((await apiErrorMessage(response)) ?? `Remote access failed (${response.status})`);
  const value: unknown = await response.json();
  return parseRemoteAccessStatus(value);
}

export async function applyRemoteAccess(
  httpUrl: BridgeHttpUrl,
  draft: RemoteAccessDraft,
  passwordAction: RemotePasswordAction,
  password?: string,
): Promise<RemoteAccessApplyStatus & { id: string }> {
  const response = await fetchWithTimeout(httpUrl("/api/local/remote-access"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      remote_access: draft,
      password_action: passwordAction,
      ...(passwordAction === "set" ? { password } : {}),
    }),
  });
  if (!response.ok) throw new Error((await apiErrorMessage(response)) ?? `Remote access failed (${response.status})`);
  const apply = parseApplyStatus(await response.json());
  if (!apply.id) throw new Error("Remote access response is missing its apply identifier");
  return { ...apply, id: apply.id };
}

export function remoteAccessDraft(status: RemoteAccessStatus): RemoteAccessDraft {
  return {
    enabled: status.remote_access.enabled,
    accepted_hosts: [...status.remote_access.accepted_hosts],
    allowed_page_origins: [...status.remote_access.allowed_page_origins],
    allowed_bridge_origins: [...status.remote_access.allowed_bridge_origins],
  };
}

export async function waitForRemoteAccessReady(
  httpUrl: BridgeHttpUrl,
  applyId: string,
  expected: (status: RemoteAccessStatus) => boolean = () => true,
  timeoutMs = APPLY_TIMEOUT_MS,
  pollIntervalMs = APPLY_POLL_INTERVAL_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    let status: RemoteAccessStatus | null = null;
    try {
      status = await fetchRemoteAccess(httpUrl);
    } catch (error) {
      lastError = error;
    }
    if (status?.apply.id !== applyId) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, pollIntervalMs));
      continue;
    }
    if (status.apply.state === "ready" && expected(status)) return status;
    if (status.apply.state === "failed") {
      throw new Error(status.apply.reason ?? "The bridge could not apply the settings");
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollIntervalMs));
  }
  throw lastError instanceof Error
    ? new Error(`The bridge did not become ready: ${lastError.message}`)
    : new Error("The bridge did not become ready after applying settings");
}

export function remoteAccessMatchesDraft(
  status: RemoteAccessStatus,
  draft: RemoteAccessDraft,
  passwordConfigured: boolean,
) {
  const model = status.remote_access;
  return model.enabled === draft.enabled &&
    model.password_configured === passwordConfigured &&
    sameValues(model.accepted_hosts, draft.accepted_hosts.map(normalizeHost)) &&
    sameValues(model.allowed_page_origins, draft.allowed_page_origins.map(normalizeOrigin)) &&
    sameValues(model.allowed_bridge_origins, draft.allowed_bridge_origins.map(normalizeOrigin));
}

export async function allowBridgeDestinations(
  httpUrl: BridgeHttpUrl,
  origins: readonly string[],
) {
  const status = await fetchRemoteAccess(httpUrl);
  const additions = origins.filter(
    (origin) => !status.remote_access.allowed_bridge_origins.includes(origin),
  );
  if (additions.length === 0) return { changed: false, status };
  if (!status.mutation_allowed) {
    throw new Error(
      status.mutation_reason ??
        "This launch cannot update browser connection permissions automatically.",
    );
  }
  const draft = remoteAccessDraft(status);
  draft.allowed_bridge_origins = [...draft.allowed_bridge_origins, ...additions];
  const apply = await applyRemoteAccess(httpUrl, draft, "keep");
  if (apply.state === "failed") {
    throw new Error(apply.reason ?? "The bridge could not apply the browser permissions");
  }
  const ready = await waitForRemoteAccessReady(
    httpUrl,
    apply.id,
    (next) => additions.every(
      (origin) => next.remote_access.allowed_bridge_origins.includes(origin),
    ),
  );
  return { changed: true, status: ready };
}

export function parseRemoteAccessStatus(value: unknown): RemoteAccessStatus {
  if (!isRecord(value) || !isRecord(value.remote_access) || !isRecord(value.apply)) {
    throw new Error("Remote access response is malformed");
  }
  const model = value.remote_access;
  if (
    typeof model.enabled !== "boolean" ||
    typeof model.password_configured !== "boolean" ||
    !stringList(model.accepted_hosts) ||
    !stringList(model.allowed_page_origins) ||
    !stringList(model.allowed_bridge_origins) ||
    typeof value.port !== "number" ||
    !Number.isSafeInteger(value.port) ||
    !stringList(value.suggestions)
  ) {
    throw new Error("Remote access response is malformed");
  }
  const apply = parseApplyStatus(value.apply);
  return {
    remote_access: {
      enabled: model.enabled,
      accepted_hosts: model.accepted_hosts,
      allowed_page_origins: model.allowed_page_origins,
      allowed_bridge_origins: model.allowed_bridge_origins,
      password_configured: model.password_configured,
    },
    port: value.port,
    suggestions: value.suggestions,
    mutation_allowed: value.mutation_allowed === true,
    mutation_reason: typeof value.mutation_reason === "string" ? value.mutation_reason : null,
    apply,
  };
}

function parseApplyStatus(value: unknown): RemoteAccessApplyStatus {
  if (!isRecord(value) ||
      (value.id !== undefined && value.id !== null &&
        (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id))) ||
      (value.state !== "applying" && value.state !== "ready" && value.state !== "failed")) {
    throw new Error("Remote access response is malformed");
  }
  return {
    id: typeof value.id === "string" ? value.id : null,
    state: value.state,
    reason: typeof value.reason === "string" ? value.reason : null,
    restored: typeof value.restored === "boolean" ? value.restored : null,
  };
}

export function bridgeAddress(host: string, port: number) {
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${port}`;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every(
    (item) => typeof item === "string" && new TextEncoder().encode(item).length <= 512,
  );
}

function normalizeHost(value: string) {
  return value.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function normalizeOrigin(value: string) {
  return value.trim().toLowerCase();
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
