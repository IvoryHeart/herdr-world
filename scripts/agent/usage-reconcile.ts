import type { UsageEvent } from "./usage-records";

export function codexUsage(value: Record<string, any>) {
  const fields = [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ] as const;
  if (
    !value ||
    fields.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)
  )
    throw new Error("Incomplete Codex token accounting");
  const write = value.cache_write_input_tokens ?? 0;
  if (
    !Number.isSafeInteger(write) ||
    write < 0 ||
    value.cached_input_tokens + write > value.input_tokens ||
    value.reasoning_output_tokens > value.output_tokens ||
    value.total_tokens !== value.input_tokens + value.output_tokens
  )
    throw new Error("Incomplete Codex token accounting");
  return {
    input: value.input_tokens,
    read: value.cached_input_tokens,
    write,
    output: value.output_tokens,
    reasoning: value.reasoning_output_tokens,
    total: value.total_tokens,
  };
}
export function snapshotId(value: Record<string, any>) {
  const u = codexUsage(value);
  return `count:${JSON.stringify([u.input, u.read, u.write, u.output, u.reasoning, u.total])}`;
}
function normalizeSnapshot(id: string) {
  if (!id.startsWith("count:{")) return id;
  try {
    return snapshotId(JSON.parse(id.slice(6)));
  } catch {
    return id;
  }
}
function fingerprint(event: UsageEvent) {
  return JSON.stringify([
    event.at,
    event.input,
    event.cacheRead,
    event.cacheWrite,
    event.output,
  ]);
}

/** Reconcile both a whole import and retained events with a later log refresh. */
export function reconcileEvents(events: UsageEvent[]): UsageEvent[] {
  const merged = new Map<string, UsageEvent>();
  for (const raw of events) {
    const event = { ...raw, id: normalizeSnapshot(raw.id) };
    const key = JSON.stringify([event.family, event.session, event.id]);
    const previous = merged.get(key);
    if (previous) {
      for (const field of [
        "input",
        "cacheRead",
        "cacheWrite",
        "output",
      ] as const)
        event[field] = Math.max(previous[field], event[field]);
      event.at = previous.at < event.at ? previous.at : event.at;
      event.replaces = [
        ...new Set([...(previous.replaces ?? []), ...(event.replaces ?? [])]),
      ];
      event.snapshot = event.snapshot ?? previous.snapshot;
      if (event.model === "unknown") event.model = previous.model;
      if (event.effort === "unknown") event.effort = previous.effort;
    }
    merged.set(key, event);
  }
  const values = [...merged.values()];
  const snapshots = values.filter(
    (e) => e.family === "codex" && e.id.startsWith("count:"),
  );
  const responses = values.filter(
    (e) => e.family === "codex" && !e.id.startsWith("count:"),
  );
  const groups = (items: UsageEvent[]) => {
    const result = new Map<string, UsageEvent[]>();
    for (const item of items) {
      const key = JSON.stringify([item.session, fingerprint(item)]);
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return result;
  };
  const snapshotGroups = groups(snapshots),
    responseGroups = groups(responses);
  for (const response of responses) {
    const aliases = new Set(response.replaces ?? []);
    if (response.snapshot) aliases.add(response.snapshot);
    // Older dedicated records lack a cumulative counter. Only a unique exact
    // timestamp AND usage match establishes their snapshot representation.
    if (
      !response.snapshot ||
      !merged.has(
        JSON.stringify([response.family, response.session, response.snapshot]),
      )
    ) {
      const key = JSON.stringify([response.session, fingerprint(response)]);
      const matches = snapshotGroups.get(key) ?? [];
      const peers = responseGroups.get(key) ?? [];
      if (matches.length === 1 && peers.length === 1)
        aliases.add(matches[0]!.id);
    }
    response.replaces = [...aliases];
    for (const alias of aliases)
      merged.delete(
        JSON.stringify([
          response.family,
          response.session,
          normalizeSnapshot(alias),
        ]),
      );
  }
  return [...merged.values()];
}
