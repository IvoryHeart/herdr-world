export type ObservabilityHealth = "available" | "degraded" | "unavailable";

export type ObservabilityExtensionResponse = {
  descriptor: {
    [key: string]: unknown;
    provider_id: string;
    health: ObservabilityHealth;
    observed_at: number;
  };
  snapshot: {
    [key: string]: unknown;
    envelopes: Array<{
      [key: string]: unknown;
      payload: {
        [key: string]: unknown;
        namespace: string;
        data: unknown;
      };
    }>;
  };
};

export type OfficeObservabilityModel = {
  provider: string;
  model: string;
  usage: Record<string, number>;
  costUsd: number | null;
  costKind: OfficeCostKind | null;
};

export type OfficeCostKind =
  | "reported"
  | "estimated"
  | "estimated_fallback"
  | "estimated_partial"
  | "mixed";

export type OfficeObservability = {
  health: ObservabilityHealth;
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

export const EMPTY_OFFICE_OBSERVABILITY: OfficeObservability = {
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

export function aggregateOfficeObservability(
  results: ReadonlyArray<
    { response: ObservabilityExtensionResponse } | { failed: true }
  >,
): OfficeObservability {
  const modelMap = new Map<string, OfficeObservabilityModel>();
  let observedAt = 0;
  let windowSeconds: number | null = null;
  let available = false;
  let degraded = false;
  let configuredSourceCount = 0;
  let failedSourceCount = 0;
  let providerId: string | null = null;

  for (const result of results) {
    if ("failed" in result) {
      degraded = true;
      failedSourceCount += 1;
      continue;
    }
    const response = result.response;
    if (response.descriptor.provider_id !== "none") {
      configuredSourceCount += 1;
      providerId ??= response.descriptor.provider_id;
    }
    observedAt = Math.max(observedAt, response.descriptor.observed_at);
    if (response.descriptor.health === "available") {
      available = true;
    } else if (response.descriptor.health !== "unavailable") {
      degraded = true;
    }
    for (const envelope of response.snapshot.envelopes) {
      if (envelope.payload.namespace !== "herdr-world.otel.metrics") {
        continue;
      }
      const data = record(envelope.payload.data);
      const rawWindow = data.window_seconds;
      if (typeof rawWindow === "number" && Number.isFinite(rawWindow)) {
        windowSeconds =
          windowSeconds === null
            ? rawWindow
            : Math.max(windowSeconds, rawWindow);
      }
      const rawModels = Array.isArray(data.models) ? data.models : [];
      for (const rawModel of rawModels) {
        const model = parseModel(rawModel);
        if (!model) {
          continue;
        }
        const key = `${model.provider}\u0000${model.model}`;
        const existing = modelMap.get(key);
        if (!existing) {
          modelMap.set(key, model);
          continue;
        }
        for (const [name, value] of Object.entries(model.usage)) {
          existing.usage[name] = (existing.usage[name] ?? 0) + value;
        }
        if (model.costUsd !== null) {
          existing.costUsd = (existing.costUsd ?? 0) + model.costUsd;
        }
        existing.costKind = mergeOfficeCostKind(
          existing.costKind,
          model.costKind,
        );
      }
    }
  }

  const models = [...modelMap.values()].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model),
  );
  const totalCostUsd = models.some(({ costUsd }) => costUsd !== null)
    ? models.reduce((total, { costUsd }) => total + (costUsd ?? 0), 0)
    : null;
  const totalUsage = models.reduce(
    (total, model) => total + officeModelUsageTotal(model.usage),
    0,
  );
  return {
    health: degraded ? "degraded" : available ? "available" : "unavailable",
    providerId,
    sourceCount: results.length,
    configuredSourceCount,
    failedSourceCount,
    observedAt,
    windowSeconds,
    models,
    totalCostUsd,
    totalUsage,
  };
}

function parseModel(value: unknown): OfficeObservabilityModel | null {
  const data = record(value);
  const provider = safeText(data.provider);
  const model = safeText(data.model);
  if (!provider || !model) {
    return null;
  }
  const usage: Record<string, number> = {};
  const rawUsage = record(data.usage);
  for (const [name, value] of Object.entries(rawUsage)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      usage[name] = value;
    }
  }
  const rawCost = data.cost_usd;
  return {
    provider,
    model,
    usage,
    costUsd:
      typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0
        ? rawCost
        : null,
    costKind: parseOfficeCostKind(data.cost_kind),
  };
}

function parseOfficeCostKind(value: unknown): OfficeCostKind | null {
  const kind = safeText(value);
  return kind === "reported" ||
    kind === "estimated" ||
    kind === "estimated_fallback" ||
    kind === "estimated_partial"
    ? kind
    : null;
}

function mergeOfficeCostKind(
  left: OfficeCostKind | null,
  right: OfficeCostKind | null,
) {
  if (left === null) return right;
  if (right === null || left === right) return left;
  return "mixed" as const;
}

export function officeModelUsageTotal(usage: Record<string, number>) {
  if (typeof usage.total === "number") {
    return usage.total;
  }
  return Object.entries(usage)
    .filter(([name]) => name !== "other")
    .reduce((total, [, value]) => total + value, 0);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function formatOfficeCost(
  value: number | null,
  kind: OfficeCostKind | null = null,
) {
  if (value === null) {
    return "—";
  }
  const prefix = kind !== null && kind !== "reported" ? "~" : "";
  if (value < 0.01) {
    return `${prefix}$0.00`;
  }
  return `${prefix}$${value.toFixed(2)}`;
}

export function formatOfficeUsage(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return Math.round(value).toString();
}

export function formatOfficeModelNames(
  models: readonly OfficeObservabilityModel[],
) {
  const names = models
    .slice(0, 3)
    .map(({ model }) => formatOfficeModelName(model));
  if (models.length > names.length) {
    names.push(`+${models.length - names.length}`);
  }
  return names.join(" · ");
}

export function formatOfficeModelName(model: string) {
  const segments = model.split("/");
  const name = segments[segments.length - 1] ?? model;
  const parts = name.split("-");
  const familyIndex = parts.findIndex((part) =>
    /^(opus|sonnet|haiku)$/iu.test(part),
  );
  if (familyIndex >= 0) {
    const isVersionPart = (part: string) => /^\d{1,2}$/u.test(part);
    const afterFamily = parts.slice(familyIndex + 1).filter(isVersionPart);
    const beforeFamily = parts.slice(0, familyIndex).filter(isVersionPart);
    const version = (afterFamily.length ? afterFamily : beforeFamily)
      .slice(0, 2)
      .join(".");
    const family =
      parts[familyIndex].charAt(0).toUpperCase() +
      parts[familyIndex].slice(1).toLowerCase();
    return [family, version].filter(Boolean).join(" ");
  }
  return name
    .replace(/^claude-/u, "")
    .replace(/^gpt-[\d.-]+-/u, "")
    .replace(/^codex-/u, "");
}
