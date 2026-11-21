import type { WorldRuntimeConnection } from "./runtimeStore";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Runtime labels by connection ID from the snapshot's hosts (#1047): the
 * machine's name, with the runtime added only where it has more than one,
 * so every view names hosts as the Hosts menu does.
 */
export function hostRuntimeLabels(value: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(value)) return labels;
  for (const entry of value) {
    const host = record(entry);
    if (!host || typeof host.label !== "string" || !host.label.trim()) continue;
    if (!Array.isArray(host.runtimes)) continue;
    const runtimes = host.runtimes
      .map(record)
      .filter(
        (runtime) =>
          runtime &&
          typeof runtime.connection_id === "string" &&
          runtime.installed !== false,
      ) as Record<string, unknown>[];
    for (const runtime of runtimes)
      labels.set(
        runtime.connection_id as string,
        runtimes.length > 1
          ? `${host.label} · ${runtime.kind === "herdr" ? "Herdr" : String(runtime.kind)}`
          : host.label,
      );
  }
  return labels;
}

export function withHostLabel(
  connection: WorldRuntimeConnection,
  labels: ReadonlyMap<string, string>,
): WorldRuntimeConnection {
  const label = labels.get(connection.connectionId);
  return label && label !== connection.label
    ? { ...connection, label }
    : connection;
}
