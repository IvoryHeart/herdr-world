import { describe, expect, test } from "bun:test";

const it = test;
import {
  aggregateOfficeObservability,
  fetchOfficeObservability,
  fetchOfficeObservabilityConfiguration,
  formatOfficeCost,
  formatOfficeModelName,
  formatOfficeModelNames,
  formatOfficeUsage,
  parseOfficeObservability,
  updateOfficeObservabilityConfiguration,
  type ObservabilityExtensionResponse,
} from "./officeObservability";

function response(
  models: unknown[],
  observedAt: number,
): ObservabilityExtensionResponse {
  return {
    descriptor: {
      extension_id: "observability",
      contract_version: { major: 1, minor: 0 },
      provider_id: "prometheus.otel",
      capabilities: [{ signal: "metrics", operations: ["snapshot"] }],
      target_scopes: [],
      freshness: { mode: "polling", max_age_ms: 60_000 },
      health: "available",
      observed_at: observedAt,
    },
    snapshot: {
      sequence: 1,
      envelopes: [
        {
          extension_id: "observability",
          contract_version: { major: 1, minor: 0 },
          provider_id: "prometheus.otel",
          observed_at: observedAt,
          status: "available",
          payload: {
            namespace: "herdr-world.otel.metrics",
            data: {
              source: "prometheus",
              aggregation: "configured_source",
              window_seconds: 86_400,
              models,
            },
          },
        },
      ],
    },
  };
}

describe("Office observability projection", () => {
  it("aggregates model usage and cost without inventing agent targets", () => {
    const result = aggregateOfficeObservability([
      {
        response: response(
          [
            {
              provider: "openai",
              model: "gpt-5.6-luna",
              usage: { total: 100 },
            },
            {
              provider: "anthropic",
              model: "claude-opus-5",
              usage: { input: 10 },
              cost_usd: 0.4,
              cost_kind: "reported",
            },
          ],
          10,
        ),
      },
      {
        response: response(
          [{ provider: "openai", model: "gpt-5.6-luna", usage: { total: 50 } }],
          20,
        ),
      },
    ]);

    expect(result.health).toBe("available");
    expect(result.providerId).toBe("prometheus.otel");
    expect(result.sourceCount).toBe(2);
    expect(result.configuredSourceCount).toBe(2);
    expect(result.failedSourceCount).toBe(0);
    expect(result.observedAt).toBe(20);
    expect(result.totalCostUsd).toBe(0.4);
    expect(result.totalUsage).toBe(160);
    expect(result.models).toEqual([
      {
        provider: "anthropic",
        model: "claude-opus-5",
        usage: { input: 10 },
        costUsd: 0.4,
        costKind: "reported",
      },
      {
        provider: "openai",
        model: "gpt-5.6-luna",
        usage: { total: 150 },
        costUsd: null,
        costKind: null,
      },
    ]);
  });

  it("marks partial source failures degraded while retaining good source data", () => {
    const result = aggregateOfficeObservability([
      {
        response: response(
          [{ provider: "openai", model: "gpt-5.6-sol", usage: { total: 4 } }],
          5,
        ),
      },
      { failed: true },
    ]);

    expect(result.health).toBe("degraded");
    expect(result.sourceCount).toBe(2);
    expect(result.configuredSourceCount).toBe(1);
    expect(result.failedSourceCount).toBe(1);
    expect(result.models).toHaveLength(1);
  });

  it("formats board values into compact, legible labels", () => {
    expect(formatOfficeCost(8.984)).toBe("$8.98");
    expect(formatOfficeCost(8.984, "estimated")).toBe("~$8.98");
    expect(formatOfficeCost(null)).toBe("—");
    expect(formatOfficeUsage(252_421_215)).toBe("252.4M");
    expect(formatOfficeUsage(900)).toBe("900");
    expect(formatOfficeModelName("anthropic/claude-haiku-4-5-20251001")).toBe(
      "Haiku 4.5",
    );
    expect(formatOfficeModelName("haiku-4-5-2025")).toBe("Haiku 4.5");
    expect(formatOfficeModelName("claude-3-5-sonnet-20241022")).toBe(
      "Sonnet 3.5",
    );
    expect(
      formatOfficeModelNames([
        {
          provider: "openai",
          model: "gpt-5.6-luna",
          usage: {},
          costUsd: null,
          costKind: null,
        },
        {
          provider: "openai",
          model: "gpt-5.6-sol",
          usage: {},
          costUsd: null,
          costKind: null,
        },
        {
          provider: "anthropic",
          model: "claude-opus-5",
          usage: {},
          costUsd: null,
          costKind: null,
        },
        {
          provider: "anthropic",
          model: "claude-sonnet-5",
          usage: {},
          costUsd: null,
          costKind: null,
        },
      ]),
    ).toBe("luna · sol · Opus 5 · +1");
  });
});

describe("Office observability service client", () => {
  test("reads bounded service snapshots and configuration", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = String(input);
      calls.push({ path, init });
      return path.endsWith("configuration")
        ? Response.json(configuration())
        : Response.json(snapshot());
    };

    expect(await fetchOfficeObservability(fetchImpl)).toEqual(snapshot());
    expect(await fetchOfficeObservabilityConfiguration(fetchImpl)).toEqual(
      configuration(),
    );
    await updateOfficeObservabilityConfiguration(
      "http://metrics.example.test/",
      fetchImpl,
    );
    expect(calls.map(({ path }) => path)).toEqual([
      "/api/world/observability/snapshot",
      "/api/world/observability/configuration",
      "/api/world/observability/configuration",
    ]);
    expect(calls[2]?.init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        prometheus_url: "http://metrics.example.test/",
      }),
    });
  });

  test("rejects malformed or unbounded service data", () => {
    expect(() =>
      parseOfficeObservability({ ...snapshot(), health: "online" }),
    ).toThrow("health");
    expect(() =>
      parseOfficeObservability({
        ...snapshot(),
        models: Array.from({ length: 129 }, () => snapshot().models[0]),
      }),
    ).toThrow("model list");
    expect(() =>
      parseOfficeObservability({
        ...snapshot(),
        models: [{ ...snapshot().models[0], usage: { input: -1 } }],
      }),
    ).toThrow("usage");
  });

  test("uses bounded server errors without accepting arbitrary bodies", async () => {
    const failure = async () =>
      Response.json({ error: "Provider URL rejected" }, { status: 400 });
    expect(
      updateOfficeObservabilityConfiguration("file:///tmp/prom", failure),
    ).rejects.toThrow("Provider URL rejected");
  });
});

function snapshot() {
  return {
    health: "available" as const,
    providerId: "prometheus.otel",
    sourceCount: 1,
    configuredSourceCount: 1,
    failedSourceCount: 0,
    observedAt: 1_700_000_000_000,
    windowSeconds: 86_400,
    models: [
      {
        provider: "openai",
        model: "gpt-example",
        usage: { input: 12, output: 3 },
        costUsd: null,
        costKind: null,
      },
    ],
    totalCostUsd: null,
    totalUsage: 15,
  };
}

function configuration() {
  return {
    providerId: "prometheus.otel",
    configured: true,
    endpoint: "http://metrics.example.test/",
    source: "settings" as const,
    health: "available" as const,
    healthReason: null,
    observedAt: 1_700_000_000_000,
    lastSuccessAt: 1_700_000_000_000,
  };
}
