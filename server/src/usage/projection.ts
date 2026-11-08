import type { UsageTokens } from "../../../shared/usage";

export type NumericUsageRow = {
  day: string;
  model: string;
  tokens: UsageTokens;
  responses: number;
  first_at: number;
  last_at: number;
};
/** A harness's own subscription-limit report: numbers and times only. */
export type LimitObservation = {
  at: number;
  source: "codex-session-log" | "claude-status-line" | "claude-transcript";
  windows: {
    window_minutes: number;
    used_percent: number;
    resets_at: number | null;
  }[];
  /** A refusal: the limit is used up until `resets_at`; `windows` is empty. */
  reached?: { window_minutes: number | null; resets_at: number };
};
/**
 * How full the session's context is: the newest main-thread response's
 * prompt size (input plus cached tokens), with the window the harness
 * reported, if it reported one. Numbers only.
 */
export type ContextObservation = {
  at: number;
  model: string;
  used_tokens: number;
  /** The model's window as the harness reported it (Codex), else null. */
  window_tokens: number | null;
};
export type SessionUsage = {
  session: string;
  partial: boolean;
  rows: NumericUsageRow[];
  limits: LimitObservation | null;
  context: ContextObservation | null;
};

/** Self-contained: the exact same function runs on the transcript's SSH host.
 * Decode transiently; retain no content, native record objects or raw errors. */
export function createUsageProjection(
  harness: string,
  now: number,
  hash = (value: string) => value,
) {
  type RecordValue = Record<string, any>;
  type Event = { id: string; at: number; model: string; tokens: UsageTokens };
  const events = new Map<string, Event>();
  const keys = [
    "input",
    "cache_read",
    "cache_write",
    "output",
    "reasoning",
  ] as const;
  let start = Math.floor(now / 86_400_000) * 86_400_000 - 6 * 86_400_000;
  let session = "",
    model = "unknown",
    partial = false;
  let previous: UsageTokens | null = null;
  let limits: LimitObservation | null = null;
  let latestContext: ContextObservation | null = null;
  const cumulativeStates = new Map<string, number>();
  const object = (v: any): RecordValue =>
    v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const identifier = (v: any) =>
    typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,159}$/.test(v)
      ? v
      : "";
  const count = (v: any, optional = false) => {
    if (v === undefined && optional) return 0;
    if (!Number.isSafeInteger(v) || v < 0 || v > 1e12)
      throw new Error("invalid usage");
    return v as number;
  };
  const time = (v: any) => (typeof v === "number" ? v : Date.parse(v));
  // Codex reports its account-wide windows with each token count. Keep only
  // the newest numeric observation; ignore plan, credits and other limit IDs.
  const rateLimits = (raw: any, at: number) => {
    const value = object(raw);
    if (
      !Number.isFinite(at) ||
      at > now + 300_000 ||
      (value.limit_id !== undefined &&
        value.limit_id !== null &&
        value.limit_id !== "codex")
    )
      return;
    const windows: LimitObservation["windows"] = [];
    for (const name of ["primary", "secondary"]) {
      if (value[name] === null || value[name] === undefined) continue;
      const w = object(value[name]);
      const used = w.used_percent,
        minutes = w.window_minutes,
        resets = w.resets_at;
      if (
        typeof used !== "number" ||
        !Number.isFinite(used) ||
        used < 0 ||
        used > 1000 ||
        !Number.isSafeInteger(minutes) ||
        minutes <= 0 ||
        minutes > 366 * 24 * 60 ||
        (resets !== undefined &&
          resets !== null &&
          (!Number.isSafeInteger(resets) || resets <= 0 || resets > 1e11))
      )
        return;
      windows.push({
        window_minutes: minutes,
        used_percent: Math.min(100, used),
        resets_at: typeof resets === "number" ? resets * 1000 : null,
      });
    }
    if (windows.length && (!limits || at >= limits.at))
      limits = { at, source: "codex-session-log", windows };
  };
  // Claude Code records its limits only when it refuses a request. The newest
  // assistant record decides: a later answer means the refusal no longer holds.
  let answeredAt = -Infinity;
  const claudeRefusal = (r: RecordValue, m: RecordValue) => {
    const at = time(r.timestamp);
    if (!Number.isFinite(at) || at > now + 300_000) return;
    if (r.apiError !== "usage_limit_reached") {
      if (!r.isApiErrorMessage && m.model !== "<synthetic>")
        answeredAt = Math.max(answeredAt, at);
      return;
    }
    const info = object(object(r.apiErrorParams).rate_limit_info),
      resets = info.resetsAt;
    if (!Number.isSafeInteger(resets) || resets <= 0 || resets > 1e11) return;
    const type =
      typeof info.rateLimitType === "string" ? info.rateLimitType : "";
    const minutes =
      type === "five_hour"
        ? 300
        : /^seven_day(?:_[a-z]+)?$/.test(type)
          ? 10080
          : null;
    if (!limits || at >= limits.at)
      limits = {
        at,
        source: "claude-transcript",
        windows: [],
        reached: { window_minutes: minutes, resets_at: resets * 1000 },
      };
  };
  // The newest response's prompt is what the session carries into its next
  // turn. An invalid or future observation is ignored, never guessed.
  const observeContext = (
    at: number,
    name: any,
    used: number,
    window: any = null,
  ) => {
    if (!Number.isFinite(at) || at > now + 300_000 || used <= 0) return;
    if (latestContext && at < latestContext.at) return;
    latestContext = {
      at,
      model: identifier(name) || "unknown",
      used_tokens: used,
      window_tokens:
        Number.isSafeInteger(window) && window > 0 && window <= 1e8
          ? window
          : null,
    };
  };
  const remember = (id: any, at: number, name: any, tokens: UsageTokens) => {
    if (
      typeof id !== "string" ||
      !id ||
      id.length > 256 ||
      !Number.isFinite(new Date(at).getTime())
    ) {
      partial = true;
      return;
    }
    if (at < start) return;
    const key = hash(id);
    if (events.size >= 32_768 && !events.has(key)) {
      partial = true;
      return;
    }
    if (!identifier(name) || name === "unknown") partial = true;
    let normalized = identifier(name) || "unknown";
    const prior = events.get(key);
    if (prior) {
      if (prior.model !== normalized) {
        partial = true;
        normalized = "unknown";
      }
      for (const k of keys) tokens[k] = Math.max(prior.tokens[k], tokens[k]);
      at = Math.max(prior.at, at);
    }
    events.set(key, { id: key, at, model: normalized, tokens });
  };
  const accept = (raw: unknown) => {
    const r = object(raw),
      p = object(r.payload),
      m = object(r.message);
    try {
      if (harness === "codex") {
        if (r.type === "session_meta" && identifier(p.id)) session = hash(p.id);
        if (r.type === "turn_context") model = identifier(p.model) || "unknown";
        if (r.type !== "event_msg" || p.type !== "token_count") return;
        if (p.rate_limits) rateLimits(p.rate_limits, time(r.timestamp));
        if (!p.info) return;
        const info = object(p.info),
          u = object(info.total_token_usage);
        const latest = object(info.last_token_usage);
        // Codex counts cached input inside input_tokens.
        if (
          Number.isSafeInteger(latest.input_tokens) &&
          latest.input_tokens <= 1e12
        )
          observeContext(
            time(r.timestamp),
            model,
            latest.input_tokens,
            info.model_context_window,
          );
        if (!Object.keys(u).length) {
          partial = true;
          return;
        }
        const input = count(u.input_tokens),
          cached = count(u.cached_input_tokens, true);
        const current: UsageTokens = {
          input: input - cached,
          cache_read: cached,
          cache_write: 0,
          output: count(u.output_tokens),
          reasoning: count(u.reasoning_output_tokens, true),
        };
        if (current.input < 0 || current.reasoning > current.output)
          throw new Error("invalid usage");
        const identity = JSON.stringify(current);
        if (cumulativeStates.has(identity)) return;
        if (cumulativeStates.size >= 32_768 && time(r.timestamp) >= start) {
          partial = true;
          return;
        }
        if (time(r.timestamp) >= start)
          cumulativeStates.set(identity, time(r.timestamp));
        const before = previous;
        if (before && keys.some((k) => current[k] < before[k])) {
          partial = true;
          return;
        }
        // A decrease cannot lower the already covered region. A subsequent
        // recovery contributes only above this last defensible high-water mark.
        previous = current;
        const delta = { ...current };
        if (before) for (const k of keys) delta[k] -= before[k];
        else {
          const last = object(info.last_token_usage);
          // A first cumulative snapshot is not proof all prior turns belong to
          // this time/model. Only accept it when it is also the first response.
          if (
            last.input_tokens !== u.input_tokens ||
            last.output_tokens !== u.output_tokens
          ) {
            partial = true;
            return;
          }
        }
        remember(identity, time(r.timestamp), model, delta);
        return;
      }
      if (harness === "claude") {
        if (identifier(r.sessionId)) session = hash(r.sessionId);
        if (r.type === "assistant") claudeRefusal(r, m);
        if (r.type !== "assistant" || !m.usage) return;
        const u = object(m.usage);
        const tokens = {
          input: count(u.input_tokens),
          cache_read: count(u.cache_read_input_tokens, true),
          cache_write: count(u.cache_creation_input_tokens, true),
          output: count(u.output_tokens),
          reasoning: 0,
        };
        remember(m.id, time(r.timestamp), m.model, { ...tokens });
        // A subagent's (sidechain) prompt is its own context, not the session's.
        if (
          r.isSidechain !== true &&
          !r.isApiErrorMessage &&
          m.model !== "<synthetic>"
        )
          observeContext(
            time(r.timestamp),
            m.model,
            tokens.input + tokens.cache_read + tokens.cache_write,
          );
        return;
      }
      if (harness === "pi") {
        if (r.type === "session" && identifier(r.id)) session = hash(r.id);
        if (r.type !== "message" || m.role !== "assistant" || !m.usage) return;
        const u = object(m.usage);
        const tokens = {
          input: count(u.input),
          cache_read: count(u.cacheRead, true),
          cache_write: count(u.cacheWrite, true),
          output: count(u.output),
          reasoning: 0,
        };
        const at = time(m.timestamp ?? r.timestamp);
        remember(r.id, at, m.model, { ...tokens });
        observeContext(
          at,
          m.model,
          tokens.input + tokens.cache_read + tokens.cache_write,
        );
        return;
      }
      if (harness === "gemini") {
        if (identifier(r.sessionId)) session = hash(r.sessionId);
        // Legacy JSON conversation and current JSONL message/event records.
        if (Array.isArray(r.messages)) {
          for (const message of r.messages) accept(message);
          return;
        }
        const record = r.type === "message" ? m : r;
        if (record.type !== "gemini" || !record.tokens) return;
        const u = object(record.tokens),
          input = count(u.input),
          cached = count(u.cached, true);
        const thought = count(u.thoughts, true),
          output = count(u.output),
          tool = count(u.tool, true);
        if (cached > input) throw new Error("invalid usage");
        remember(record.id, time(record.timestamp), record.model, {
          input: input + tool - cached,
          cache_read: cached,
          cache_write: 0,
          output: output + thought,
          reasoning: thought,
        });
        // Gemini's input already includes its cached tokens.
        observeContext(time(record.timestamp), record.model, input + tool);
      }
    } catch {
      partial = true;
    }
  };
  return {
    accept,
    incomplete() {
      partial = true;
    },
    refresh(at: number) {
      now = at;
      start = Math.floor(now / 86_400_000) * 86_400_000 - 6 * 86_400_000;
      for (const [key, event] of events)
        if (event.at < start) events.delete(key);
      for (const [key, at] of cumulativeStates)
        if (at < start) cumulativeStates.delete(key);
    },
    context(value?: string) {
      if (value !== undefined) model = value;
      return model;
    },
    cacheBytes() {
      return Buffer.byteLength(
        JSON.stringify([
          [...events],
          [...cumulativeStates],
          previous,
          limits,
          latestContext,
          model,
          session,
          partial,
        ]),
      );
    },
    finish(): SessionUsage {
      const rows = new Map<string, NumericUsageRow>();
      for (const e of events.values()) {
        if (e.at < start || e.at >= now) continue;
        const day = new Date(e.at).toISOString().slice(0, 10),
          key = `${day}\0${e.model}`;
        let row = rows.get(key);
        if (!row)
          rows.set(
            key,
            (row = {
              day,
              model: e.model,
              tokens: {
                input: 0,
                cache_read: 0,
                cache_write: 0,
                output: 0,
                reasoning: 0,
              },
              responses: 0,
              first_at: e.at,
              last_at: e.at,
            }),
          );
        for (const k of keys) row.tokens[k] += e.tokens[k];
        row.responses++;
        row.first_at = Math.min(row.first_at, e.at);
        row.last_at = Math.max(row.last_at, e.at);
      }
      const current: LimitObservation | null = limits;
      return {
        session,
        partial,
        rows: [...rows.values()],
        limits: current?.reached && answeredAt > current.at ? null : current,
        context: latestContext,
      };
    },
  };
}
