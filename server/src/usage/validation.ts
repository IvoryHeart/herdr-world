import type { HostUsage } from "./collector";
import type { LimitObservation } from "./projection";

/** Never let a remote projection smuggle text, paths, invalid counts or unbounded rows. */
export function validateHostUsage(raw: any): HostUsage {
  const harnesses = ["claude", "codex", "pi", "gemini"];
  const states = ["available", "partial", "missing", "stale", "unavailable"];
  const digest = (v: unknown) =>
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const count = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e16;
  if (
    !raw ||
    !Array.isArray(raw.rows) ||
    raw.rows.length > 1024 ||
    !Array.isArray(raw.sources) ||
    raw.sources.length !== 4 ||
    typeof raw.truncated !== "boolean"
  )
    throw new Error("Invalid numeric usage projection");
  const seenSources = new Set<string>();
  const sources = raw.sources.map((s: any) => {
    if (
      !harnesses.includes(s?.harness) ||
      !states.includes(s?.state) ||
      seenSources.has(s.harness)
    )
      throw new Error("Invalid usage source");
    seenSources.add(s.harness);
    return {
      harness: s.harness as string,
      state: s.state as HostUsage["sources"][number]["state"],
    };
  });
  const rows = raw.rows.map((r: any) => {
    if (
      !harnesses.includes(r?.harness) ||
      !digest(r.session_key) ||
      !Array.isArray(r.file_keys) ||
      r.file_keys.length > 16 ||
      !r.file_keys.every(digest) ||
      typeof r.model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,159}$/.test(r.model) ||
      typeof r.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
      !Number.isFinite(Date.parse(r.day)) ||
      new Date(Date.parse(r.day)).toISOString().slice(0, 10) !== r.day ||
      !count(r.responses) ||
      !count(r.first_at) ||
      !count(r.last_at) ||
      r.last_at < r.first_at ||
      typeof r.partial !== "boolean" ||
      !r.tokens
    )
      throw new Error("Invalid usage row");
    const tokens = {
      input: r.tokens.input,
      cache_read: r.tokens.cache_read,
      cache_write: r.tokens.cache_write,
      output: r.tokens.output,
      reasoning: r.tokens.reasoning,
    };
    if (!Object.values(tokens).every(count) || tokens.reasoning > tokens.output)
      throw new Error("Invalid usage counters");
    if (
      new Date(r.first_at).toISOString().slice(0, 10) !== r.day ||
      new Date(r.last_at).toISOString().slice(0, 10) !== r.day
    )
      throw new Error("Invalid usage day");
    return {
      harness: r.harness as string,
      session_key: r.session_key as string,
      file_keys: r.file_keys as string[],
      model: r.model as string,
      day: r.day as string,
      responses: r.responses as number,
      first_at: r.first_at as number,
      last_at: r.last_at as number,
      partial: r.partial as boolean,
      tokens,
    };
  });
  if (
    raw.title_matches !== undefined &&
    (!Array.isArray(raw.title_matches) || raw.title_matches.length > 128)
  )
    throw new Error("Invalid usage title matches");
  const title_matches = (raw.title_matches ?? []).map((match: any) => {
    if (!digest(match?.prefix_key) || !digest(match?.session_key))
      throw new Error("Invalid usage title match");
    return {
      prefix_key: match.prefix_key as string,
      session_key: match.session_key as string,
    };
  });
  if (
    new Set(
      title_matches.map((match: { prefix_key: string }) => match.prefix_key),
    ).size !== title_matches.length
  )
    throw new Error("Ambiguous usage title matches");
  if (
    raw.limits !== undefined &&
    (!Array.isArray(raw.limits) || raw.limits.length > 4)
  )
    throw new Error("Invalid usage limits");
  const limitHarnesses = new Set<string>();
  const sourcesFor: Record<string, string[]> = {
    codex: ["codex-session-log"],
    claude: ["claude-status-line", "claude-transcript"],
  };
  const limits = (raw.limits ?? []).map((limit: any) => {
    const reached = limit?.reached;
    if (
      !Object.hasOwn(sourcesFor, limit?.harness) ||
      !sourcesFor[limit.harness]!.includes(limit.source) ||
      limitHarnesses.has(limit.harness) ||
      !count(limit.at) ||
      !Array.isArray(limit.windows) ||
      limit.windows.length > 2 ||
      (reached === undefined
        ? limit.windows.length < 1
        : limit.source !== "claude-transcript" ||
          limit.windows.length !== 0 ||
          !reached ||
          typeof reached !== "object" ||
          !count(reached.resets_at) ||
          (reached.window_minutes !== null &&
            reached.window_minutes !== 300 &&
            reached.window_minutes !== 10080))
    )
      throw new Error("Invalid usage limit");
    limitHarnesses.add(limit.harness);
    return {
      harness: limit.harness as string,
      at: limit.at as number,
      source: limit.source as LimitObservation["source"],
      windows: limit.windows.map((w: any) => {
        if (
          !Number.isSafeInteger(w?.window_minutes) ||
          w.window_minutes <= 0 ||
          w.window_minutes > 366 * 24 * 60 ||
          typeof w.used_percent !== "number" ||
          !Number.isFinite(w.used_percent) ||
          w.used_percent < 0 ||
          w.used_percent > 100 ||
          (w.resets_at !== null && !count(w.resets_at))
        )
          throw new Error("Invalid usage limit window");
        return {
          window_minutes: w.window_minutes as number,
          used_percent: w.used_percent as number,
          resets_at: w.resets_at as number | null,
        };
      }),
      ...(reached === undefined
        ? {}
        : {
            reached: {
              window_minutes: reached.window_minutes as number | null,
              resets_at: reached.resets_at as number,
            },
          }),
    };
  });
  if (
    raw.contexts !== undefined &&
    (!Array.isArray(raw.contexts) || raw.contexts.length > 256)
  )
    throw new Error("Invalid usage contexts");
  const contexts = (raw.contexts ?? []).map((c: any) => {
    if (
      !harnesses.includes(c?.harness) ||
      !digest(c.session_key) ||
      !Array.isArray(c.file_keys) ||
      c.file_keys.length > 16 ||
      !c.file_keys.every(digest) ||
      typeof c.model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,159}$/.test(c.model) ||
      !count(c.at) ||
      !count(c.used_tokens) ||
      c.used_tokens > 1e12 ||
      (c.window_tokens !== null &&
        (!count(c.window_tokens) ||
          c.window_tokens === 0 ||
          c.window_tokens > 1e8))
    )
      throw new Error("Invalid usage context");
    return {
      harness: c.harness as string,
      session_key: c.session_key as string,
      file_keys: c.file_keys as string[],
      model: c.model as string,
      at: c.at as number,
      used_tokens: c.used_tokens as number,
      window_tokens: c.window_tokens as number | null,
    };
  });
  return {
    rows,
    sources,
    truncated: raw.truncated,
    limits,
    contexts,
    title_matches,
  };
}
