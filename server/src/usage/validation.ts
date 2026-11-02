import type { HostUsage } from "./collector";

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
  return { rows, sources, truncated: raw.truncated, title_matches };
}
