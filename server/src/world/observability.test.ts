import { describe, expect, test } from "bun:test";
import {
  normalizePrometheusUrl,
  OfficeObservabilityService,
} from "./observability";

describe("Office observability service", () => {
  test("validates a bounded credential-free Prometheus base URL", () => {
    expect(normalizePrometheusUrl(" http://127.0.0.1:9101/prom ")).toBe(
      "http://127.0.0.1:9101/prom/",
    );
    expect(normalizePrometheusUrl("")).toBeNull();
    expect(() => normalizePrometheusUrl("file:///tmp/prom")).toThrow(
      "http:// or https://",
    );
    expect(() =>
      normalizePrometheusUrl("http://user:pass@example.test"),
    ).toThrow("no credentials");
    expect(() =>
      normalizePrometheusUrl("http://example.test?q=secret"),
    ).toThrow("query or fragment");
  });

  test("returns unavailable without querying when no provider is configured", async () => {
    let calls = 0;
    const service = new OfficeObservabilityService({
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse([]);
      },
    });

    expect(await service.snapshot()).toMatchObject({
      health: "unavailable",
      providerId: null,
      models: [],
    });
    expect(service.configuration()).toMatchObject({
      configured: false,
      source: "none",
    });
    expect(calls).toBe(0);
  });

  test("queries bounded token and reported-cost metrics and caches refreshes", async () => {
    const urls: string[] = [];
    let now = 1_000;
    const service = new OfficeObservabilityService({
      endpoint: "http://metrics.example.test/prometheus",
      now: () => now,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const query = new URL(url).searchParams.get("query") ?? "";
        if (query.includes("codex_turn")) {
          return jsonResponse([
            sample({ model: "gpt-example", token_type: "input" }, "120"),
            sample({ model: "gpt-example", token_type: "output" }, "30"),
          ]);
        }
        if (query.includes("cost_usage")) {
          return jsonResponse([sample({ model: "claude-example" }, "0.42")]);
        }
        return jsonResponse([
          sample({ model: "claude-example", type: "cacheRead" }, "15"),
        ]);
      },
    });

    const snapshot = await service.snapshot();
    expect(urls).toHaveLength(3);
    expect(
      urls.every((url) =>
        url.startsWith("http://metrics.example.test/prometheus/api/v1/query?"),
      ),
    ).toBe(true);
    expect(snapshot).toMatchObject({
      health: "available",
      providerId: "prometheus.otel",
      totalUsage: 165,
      totalCostUsd: 0.42,
      failedSourceCount: 0,
    });
    expect(snapshot.models).toEqual([
      {
        provider: "anthropic",
        model: "claude-example",
        usage: { cached_input: 15 },
        costUsd: 0.42,
        costKind: "reported",
      },
      {
        provider: "openai",
        model: "gpt-example",
        usage: { input: 120, output: 30 },
        costUsd: null,
        costKind: null,
      },
    ]);
    expect(service.configuration()).toMatchObject({
      health: "available",
      lastSuccessAt: 1_000,
    });

    now += 10_000;
    await service.snapshot();
    expect(urls).toHaveLength(3);
  });

  test("degrades on failed or oversized provider responses without throwing", async () => {
    const service = new OfficeObservabilityService({
      endpoint: "https://metrics.example.test",
      fetchImpl: async () =>
        new Response("x".repeat(256 * 1024 + 1), {
          headers: { "content-type": "application/json" },
        }),
    });

    expect(await service.snapshot()).toMatchObject({
      health: "degraded",
      failedSourceCount: 1,
      models: [],
    });
    expect(service.configuration()).toMatchObject({
      healthReason: "provider_query_failed",
      lastSuccessAt: null,
    });
  });

  test("does not publish an old provider response after configuration changes", async () => {
    const first = Promise.withResolvers<Response>();
    const service = new OfficeObservabilityService({
      endpoint: "http://old.example.test",
      fetchImpl: async (input) =>
        String(input).includes("old.example.test")
          ? first.promise
          : jsonResponse([]),
    });
    const staleRefresh = service.refresh(true);
    await service.configure("http://new.example.test", "settings");
    first.resolve(jsonResponse([sample({ model: "stale" }, "1")]));
    await staleRefresh;

    expect(service.configuration()).toMatchObject({
      endpoint: "http://new.example.test/",
      source: "settings",
      health: "available",
    });
    expect((await service.snapshot()).models).toEqual([]);
  });
});

function sample(metric: Record<string, string>, value: string) {
  return { metric, value: [1_700_000_000, value] };
}

function jsonResponse(result: unknown[]) {
  return Response.json({
    status: "success",
    data: { resultType: "vector", result },
  });
}
