import { describe, expect, test } from "bun:test";
import type { GuiSettings } from "../config/gui-settings";
import {
  createOfficeObservabilityHttpHandler,
  OFFICE_OBSERVABILITY_CONFIG_PATH,
  OFFICE_OBSERVABILITY_SETTINGS_KEY,
  OFFICE_OBSERVABILITY_SNAPSHOT_PATH,
  resolveOfficeObservabilityBootstrap,
  withOfficeObservabilityEndpoint,
} from "./observability-http";
import { OfficeObservabilityService } from "./observability";

describe("Office observability HTTP boundary", () => {
  test("serves configuration and an unavailable snapshot without a provider", async () => {
    const handle = createOfficeObservabilityHttpHandler({
      service: new OfficeObservabilityService(),
      persist: async () => {},
    });
    const configuration = await handle(
      request(OFFICE_OBSERVABILITY_CONFIG_PATH),
      OFFICE_OBSERVABILITY_CONFIG_PATH,
    );
    const snapshot = await handle(
      request(OFFICE_OBSERVABILITY_SNAPSHOT_PATH),
      OFFICE_OBSERVABILITY_SNAPSHOT_PATH,
    );

    expect(await configuration?.json()).toMatchObject({
      configured: false,
      endpoint: null,
      health: "unavailable",
    });
    expect(await snapshot?.json()).toMatchObject({
      health: "unavailable",
      models: [],
    });
    expect(configuration?.headers.get("cache-control")).toBe("no-store");
    expect(snapshot?.headers.get("cache-control")).toBe("no-store");
  });

  test("persists a validated setting before applying it", async () => {
    const order: string[] = [];
    const service = new OfficeObservabilityService({
      fetchImpl: async () => {
        order.push("query");
        return Response.json({
          status: "success",
          data: { resultType: "vector", result: [] },
        });
      },
    });
    const handle = createOfficeObservabilityHttpHandler({
      service,
      persist: async (endpoint) => {
        order.push(`persist:${endpoint}`);
      },
    });
    const response = await handle(
      request(OFFICE_OBSERVABILITY_CONFIG_PATH, {
        method: "PUT",
        body: JSON.stringify({ prometheus_url: "http://metrics.example.test" }),
      }),
      OFFICE_OBSERVABILITY_CONFIG_PATH,
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      configured: true,
      endpoint: "http://metrics.example.test/",
      source: "settings",
      health: "available",
    });
    expect(order[0]).toBe("persist:http://metrics.example.test/");
    expect(order.slice(1)).toEqual(["query", "query", "query"]);
  });

  test("rejects malformed, credential-bearing, and oversized updates without persistence", async () => {
    let writes = 0;
    const handle = createOfficeObservabilityHttpHandler({
      service: new OfficeObservabilityService(),
      persist: async () => {
        writes += 1;
      },
    });
    for (const body of [
      { prometheus_url: "http://user:secret@example.test" },
      { prometheus_url: "http://example.test", extra: true },
      { prometheus_url: 4 },
    ]) {
      const response = await handle(
        request(OFFICE_OBSERVABILITY_CONFIG_PATH, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
        OFFICE_OBSERVABILITY_CONFIG_PATH,
      );
      expect(response?.status).toBe(400);
    }
    const oversized = await handle(
      request(OFFICE_OBSERVABILITY_CONFIG_PATH, {
        method: "PUT",
        body: JSON.stringify({ prometheus_url: `http://${"a".repeat(5_000)}` }),
      }),
      OFFICE_OBSERVABILITY_CONFIG_PATH,
    );
    expect(oversized?.status).toBe(400);
    expect(writes).toBe(0);
  });

  test("does not replace live configuration when persistence fails", async () => {
    const service = new OfficeObservabilityService({
      endpoint: "http://old.example.test",
    });
    const handle = createOfficeObservabilityHttpHandler({
      service,
      persist: async () => {
        throw new Error("disk unavailable");
      },
    });
    const response = await handle(
      request(OFFICE_OBSERVABILITY_CONFIG_PATH, {
        method: "PUT",
        body: JSON.stringify({ prometheus_url: "http://new.example.test" }),
      }),
      OFFICE_OBSERVABILITY_CONFIG_PATH,
    );

    expect(response?.status).toBe(500);
    expect(service.configuration().endpoint).toBe("http://old.example.test/");
  });
});

describe("Office observability persistence", () => {
  test("uses saved settings before the environment and preserves an explicit disable", () => {
    const settings = guiSettings();
    expect(
      resolveOfficeObservabilityBootstrap(settings, {
        HERDR_WORLD_OTEL_PROMETHEUS_URL: "http://env.example.test",
      }),
    ).toEqual({
      endpoint: "http://env.example.test/",
      source: "environment",
    });

    const saved = withOfficeObservabilityEndpoint(
      settings,
      "http://saved.example.test/",
    );
    expect(
      resolveOfficeObservabilityBootstrap(saved, {
        HERDR_WORLD_OTEL_PROMETHEUS_URL: "http://env.example.test",
      }),
    ).toEqual({
      endpoint: "http://saved.example.test/",
      source: "settings",
    });

    const disabled = withOfficeObservabilityEndpoint(saved, null);
    expect(
      resolveOfficeObservabilityBootstrap(disabled, {
        HERDR_WORLD_OTEL_PROMETHEUS_URL: "http://env.example.test",
      }),
    ).toEqual({ endpoint: null, source: "settings" });
    expect(disabled.custom[OFFICE_OBSERVABILITY_SETTINGS_KEY]).toBeNull();
  });
});

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function guiSettings(): GuiSettings {
  return {
    version: 1,
    repositories: {},
    workspace_auto_sync: {},
    custom: {},
  };
}
