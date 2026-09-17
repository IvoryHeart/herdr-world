import type { GuiSettings } from "../config/gui-settings";
import { worldEnv } from "../config/environment";
import {
  normalizePrometheusUrl,
  type OfficeObservabilityConfiguration,
  OfficeObservabilityService,
} from "./observability";

export const OFFICE_OBSERVABILITY_CONFIG_PATH =
  "/api/world/observability/configuration";
export const OFFICE_OBSERVABILITY_SNAPSHOT_PATH =
  "/api/world/observability/snapshot";
export const OFFICE_OBSERVABILITY_SETTINGS_KEY =
  "office_observability_prometheus_url";

const MAX_CONFIG_BODY_BYTES = 4 * 1024;

type ObservabilityHttpOptions = {
  service: OfficeObservabilityService;
  persist(endpoint: string | null): Promise<void>;
};

export function createOfficeObservabilityHttpHandler({
  service,
  persist,
}: ObservabilityHttpOptions) {
  return async (request: Request, pathname: string) => {
    if (pathname === OFFICE_OBSERVABILITY_CONFIG_PATH) {
      if (request.method === "GET") {
        return jsonResponse(service.configuration());
      }
      if (request.method !== "PUT") return methodNotAllowed("GET, PUT");
      let endpoint: string | null;
      try {
        endpoint = normalizePrometheusUrl(
          (await readConfigurationBody(request)).prometheus_url,
        );
      } catch (cause) {
        return jsonError(errorMessage(cause), 400);
      }
      try {
        await persist(endpoint);
      } catch {
        return jsonError("Could not save Office observability settings", 500);
      }
      const configuration = await service.configure(endpoint, "settings");
      return jsonResponse(configuration);
    }
    if (pathname === OFFICE_OBSERVABILITY_SNAPSHOT_PATH) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(await service.snapshot());
    }
    return null;
  };
}

export function resolveOfficeObservabilityBootstrap(
  settings: Pick<GuiSettings, "custom">,
  environment: Record<string, string | undefined> = process.env,
): {
  endpoint: string | null;
  source: OfficeObservabilityConfiguration["source"];
} {
  if (Object.hasOwn(settings.custom, OFFICE_OBSERVABILITY_SETTINGS_KEY)) {
    return {
      endpoint: normalizePrometheusUrl(
        settings.custom[OFFICE_OBSERVABILITY_SETTINGS_KEY],
      ),
      source: "settings",
    };
  }
  const endpoint = normalizePrometheusUrl(
    worldEnv("OTEL_PROMETHEUS_URL", environment),
  );
  return { endpoint, source: endpoint ? "environment" : "none" };
}

export function withOfficeObservabilityEndpoint(
  settings: GuiSettings,
  endpoint: string | null,
): GuiSettings {
  return {
    ...settings,
    custom: {
      ...settings.custom,
      [OFFICE_OBSERVABILITY_SETTINGS_KEY]: endpoint,
    },
  };
}

async function readConfigurationBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CONFIG_BODY_BYTES
  ) {
    throw new Error("Office observability settings are too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CONFIG_BODY_BYTES) {
    throw new Error("Office observability settings are too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Office observability settings must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Office observability settings must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "prometheus_url") ||
    !(
      typeof record.prometheus_url === "string" ||
      record.prometheus_url === null
    )
  ) {
    throw new Error("Office observability settings have invalid fields");
  }
  return record as { prometheus_url: string | null };
}

function methodNotAllowed(allow: string) {
  return new Response("method not allowed", {
    status: 405,
    headers: { allow },
  });
}

function jsonError(error: string, status: number) {
  return jsonResponse({ error }, { status });
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(value, { ...init, headers });
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Invalid settings";
}
