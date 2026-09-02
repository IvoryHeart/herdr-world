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
  apply: {
    state: "applying" | "ready" | "failed";
    reason?: string | null;
    restored?: boolean | null;
  };
};

export type RemoteAccessDraft = Omit<RemoteAccessModel, "password_configured">;
export type RemotePasswordAction = "keep" | "set" | "remove";

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
) {
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
  return (await response.json()) as RemoteAccessStatus["apply"];
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
  const apply = value.apply;
  if (apply.state !== "applying" && apply.state !== "ready" && apply.state !== "failed") {
    throw new Error("Remote access response is malformed");
  }
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
    apply: {
      state: apply.state,
      reason: typeof apply.reason === "string" ? apply.reason : null,
      restored: typeof apply.restored === "boolean" ? apply.restored : null,
    },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
