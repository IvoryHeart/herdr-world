const PROVIDER_ID = "prometheus.otel";
const PAYLOAD_WINDOW_SECONDS = 24 * 60 * 60;
const DEFAULT_REFRESH_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PROVIDER_URL_LENGTH = 2_048;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SAMPLES_PER_QUERY = 512;
const MAX_MODELS = 128;
const MAX_MODEL_LENGTH = 160;
const MAX_METRIC_VALUE = 1e18;

export type OfficeObservabilityHealth =
  | "available"
  | "degraded"
  | "unavailable";

export type OfficeObservabilityModel = {
  provider: string;
  model: string;
  usage: Record<string, number>;
  costUsd: number | null;
  costKind: "reported" | null;
};

export type OfficeObservabilitySnapshot = {
  health: OfficeObservabilityHealth;
  providerId: string | null;
  sourceCount: number;
  configuredSourceCount: number;
  failedSourceCount: number;
  observedAt: number;
  windowSeconds: number | null;
  models: OfficeObservabilityModel[];
  totalCostUsd: number | null;
  totalUsage: number;
};

export type OfficeObservabilityConfiguration = {
  providerId: string;
  configured: boolean;
  endpoint: string | null;
  source: "environment" | "settings" | "none";
  health: OfficeObservabilityHealth;
  healthReason: "provider_query_failed" | null;
  observedAt: number;
  lastSuccessAt: number | null;
};

type PrometheusSample = {
  metric: Record<string, string>;
  value: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type OfficeObservabilityServiceOptions = {
  endpoint?: string | null;
  source?: OfficeObservabilityConfiguration["source"];
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshMs?: number;
  timeoutMs?: number;
};

export class OfficeObservabilityService {
  #endpoint: string | null;
  #source: OfficeObservabilityConfiguration["source"];
  #fetch: FetchLike;
  #now: () => number;
  #refreshMs: number;
  #timeoutMs: number;
  #snapshot: OfficeObservabilitySnapshot;
  #healthReason: OfficeObservabilityConfiguration["healthReason"] = null;
  #lastSuccessAt: number | null = null;
  #attemptedAt = 0;
  #generation = 0;
  #refreshPromise: Promise<OfficeObservabilitySnapshot> | null = null;

  constructor({
    endpoint = null,
    source = endpoint ? "environment" : "none",
    fetchImpl = fetch,
    now = Date.now,
    refreshMs = DEFAULT_REFRESH_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: OfficeObservabilityServiceOptions = {}) {
    this.#endpoint = normalizePrometheusUrl(endpoint);
    this.#source = this.#endpoint
      ? source
      : source === "settings"
        ? source
        : "none";
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#refreshMs = Math.max(1, refreshMs);
    this.#timeoutMs = Math.max(1, timeoutMs);
    this.#snapshot = emptyOfficeObservability();
  }

  configuration(): OfficeObservabilityConfiguration {
    return {
      providerId: this.#endpoint ? PROVIDER_ID : "none",
      configured: this.#endpoint !== null,
      endpoint: this.#endpoint,
      source: this.#source,
      health: this.#snapshot.health,
      healthReason: this.#healthReason,
      observedAt: this.#snapshot.observedAt,
      lastSuccessAt: this.#lastSuccessAt,
    };
  }

  async configure(
    endpoint: string | null,
    source: OfficeObservabilityConfiguration["source"] = "settings",
  ) {
    this.#endpoint = normalizePrometheusUrl(endpoint);
    this.#source = this.#endpoint
      ? source
      : source === "settings"
        ? source
        : "none";
    this.#generation += 1;
    this.#refreshPromise = null;
    this.#attemptedAt = 0;
    this.#lastSuccessAt = null;
    this.#healthReason = null;
    this.#snapshot = emptyOfficeObservability();
    if (this.#endpoint) await this.refresh(true);
    return this.configuration();
  }

  async snapshot() {
    await this.refresh(false);
    return this.#snapshot;
  }

  async refresh(force = false): Promise<OfficeObservabilitySnapshot> {
    const endpoint = this.#endpoint;
    if (!endpoint) return this.#snapshot;
    const now = this.#now();
    if (
      !force &&
      this.#attemptedAt &&
      now - this.#attemptedAt < this.#refreshMs
    ) {
      return this.#snapshot;
    }
    if (this.#refreshPromise) return this.#refreshPromise;
    const generation = this.#generation;
    this.#attemptedAt = now;
    const task = this.#fetchSnapshot(endpoint, now).then((result) => {
      if (generation !== this.#generation || endpoint !== this.#endpoint) {
        return this.#snapshot;
      }
      this.#snapshot = result.snapshot;
      this.#healthReason = result.failed ? "provider_query_failed" : null;
      if (!result.failed) this.#lastSuccessAt = result.snapshot.observedAt;
      return this.#snapshot;
    });
    this.#refreshPromise = task;
    void task.finally(() => {
      if (this.#refreshPromise === task) this.#refreshPromise = null;
    });
    return task;
  }

  async #fetchSnapshot(endpoint: string, observedAt: number) {
    const queries = [
      {
        provider: "openai",
        usageLabel: "token_type",
        expression: `sum by (model, token_type) (increase(codex_turn_token_usage_sum[${PAYLOAD_WINDOW_SECONDS}s]))`,
      },
      {
        provider: "anthropic",
        usageLabel: "type",
        expression: `sum by (model, type) (increase(claude_code_token_usage_tokens_total[${PAYLOAD_WINDOW_SECONDS}s]))`,
      },
      {
        provider: "anthropic",
        usageLabel: null,
        expression: `sum by (model) (increase(claude_code_cost_usage_USD_total[${PAYLOAD_WINDOW_SECONDS}s]))`,
      },
    ] as const;
    const results = await Promise.allSettled(
      queries.map(({ expression }) => this.#query(endpoint, expression)),
    );
    const modelMap = new Map<string, OfficeObservabilityModel>();
    for (const [index, result] of results.entries()) {
      if (result.status !== "fulfilled") continue;
      const query = queries[index];
      if (!query) continue;
      for (const sample of result.value) {
        const model = boundedModel(sample.metric.model);
        if (!model) continue;
        const key = `${query.provider}\0${model}`;
        const entry = modelMap.get(key) ?? {
          provider: query.provider,
          model,
          usage: {},
          costUsd: null,
          costKind: null,
        };
        if (query.usageLabel) {
          const usageName = normalizeUsageName(
            sample.metric[query.usageLabel] ?? "unknown",
          );
          entry.usage[usageName] = (entry.usage[usageName] ?? 0) + sample.value;
        } else {
          entry.costUsd = (entry.costUsd ?? 0) + sample.value;
          entry.costKind = "reported";
        }
        modelMap.set(key, entry);
      }
    }
    const models = [...modelMap.values()]
      .sort(
        (left, right) =>
          left.provider.localeCompare(right.provider) ||
          left.model.localeCompare(right.model),
      )
      .slice(0, MAX_MODELS);
    const totalCostUsd = models.some(({ costUsd }) => costUsd !== null)
      ? models.reduce((total, { costUsd }) => total + (costUsd ?? 0), 0)
      : null;
    const totalUsage = models.reduce(
      (total, model) => total + modelUsageTotal(model.usage),
      0,
    );
    const failed = results.some(({ status }) => status === "rejected");
    return {
      failed,
      snapshot: {
        health: failed ? ("degraded" as const) : ("available" as const),
        providerId: PROVIDER_ID,
        sourceCount: 1,
        configuredSourceCount: 1,
        failedSourceCount: failed ? 1 : 0,
        observedAt,
        windowSeconds: PAYLOAD_WINDOW_SECONDS,
        models,
        totalCostUsd,
        totalUsage,
      },
    };
  }

  async #query(endpoint: string, expression: string) {
    const url = new URL("api/v1/query", endpoint);
    url.searchParams.set("query", expression);
    const response = await this.#fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error("Prometheus query failed");
    const value = JSON.parse(await readBoundedText(response));
    return parsePrometheusResponse(value);
  }
}

export function normalizePrometheusUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error("Prometheus URL must be a string");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PROVIDER_URL_LENGTH) {
    throw new Error("Prometheus URL is too long");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Prometheus URL must be a valid http:// or https:// URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Prometheus URL must use http:// or https://");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("Prometheus URL must include a host and no credentials");
  }
  if (url.search || url.hash) {
    throw new Error("Prometheus URL must not include a query or fragment");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export function emptyOfficeObservability(): OfficeObservabilitySnapshot {
  return {
    health: "unavailable",
    providerId: null,
    sourceCount: 0,
    configuredSourceCount: 0,
    failedSourceCount: 0,
    observedAt: 0,
    windowSeconds: null,
    models: [],
    totalCostUsd: null,
    totalUsage: 0,
  };
}

function parsePrometheusResponse(value: unknown): PrometheusSample[] {
  const root = record(value);
  const data = record(root.data);
  if (root.status !== "success" || data.resultType !== "vector") {
    throw new Error("Prometheus response is not a successful vector");
  }
  if (
    !Array.isArray(data.result) ||
    data.result.length > MAX_SAMPLES_PER_QUERY
  ) {
    throw new Error("Prometheus response has too many samples");
  }
  return data.result.map((raw) => {
    const sample = record(raw);
    const metric = record(sample.metric);
    const pair = sample.value;
    if (!Array.isArray(pair) || pair.length < 2) {
      throw new Error("Prometheus sample is malformed");
    }
    const numeric = typeof pair[1] === "number" ? pair[1] : Number(pair[1]);
    if (
      !Number.isFinite(numeric) ||
      numeric < 0 ||
      numeric > MAX_METRIC_VALUE
    ) {
      throw new Error("Prometheus sample value is invalid");
    }
    const labels: Record<string, string> = {};
    for (const [name, label] of Object.entries(metric)) {
      if (typeof label === "string") labels[name] = label;
    }
    return { metric: labels, value: numeric };
  });
}

async function readBoundedText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Prometheus response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Prometheus response is too large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function boundedModel(value: unknown) {
  return typeof value === "string" && value.trim()
    ? [...value.trim()].slice(0, MAX_MODEL_LENGTH).join("")
    : null;
}

function normalizeUsageName(value: string) {
  if (
    [
      "cacheCreation",
      "cache_creation",
      "cache_write",
      "cache_write_input",
    ].includes(value)
  ) {
    return "cache_write_input";
  }
  if (["cacheRead", "cache_read", "cached_input"].includes(value)) {
    return "cached_input";
  }
  if (value === "input" || value === "input_tokens") return "input";
  if (value === "output" || value === "output_tokens") return "output";
  if (value === "reasoning_output") return "reasoning_output";
  if (value === "total" || value === "total_tokens") return "total";
  return "other";
}

function modelUsageTotal(usage: Record<string, number>) {
  if (typeof usage.total === "number") return usage.total;
  return Object.entries(usage)
    .filter(([name]) => name !== "other")
    .reduce((total, [, value]) => total + value, 0);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
