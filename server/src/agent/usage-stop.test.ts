import { expect, test } from "bun:test";
import { usageStopFromRecords } from "./usage-stop";
import { usageStopCurrent, usageStopText } from "../../../shared/usageStop";

// Synthetic harness records only: no real accounts, plans or sessions.
const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 7, 12, minute)).toISOString();
const reset = Date.UTC(2026, 10, 7, 15, 0) / 1000;

const codexLimits = (minute: number, reached: string | null, used = 100) => ({
  timestamp: at(minute),
  type: "event_msg",
  payload: {
    type: "token_count",
    info: null,
    rate_limits: {
      limit_id: "codex",
      primary: { used_percent: used, window_minutes: 300, resets_at: reset },
      secondary: {
        used_percent: 40,
        window_minutes: 10080,
        resets_at: reset + 86_400,
      },
      credits: { has_credits: false, balance: "SYNTHETIC" },
      plan_type: "SYNTHETIC",
      rate_limit_reached_type: reached,
    },
  },
});
const codexUser = (minute: number) => ({
  timestamp: at(minute),
  type: "response_item",
  payload: { type: "message", role: "user", content: [] },
});
const codexAnswer = (minute: number) => ({
  timestamp: at(minute),
  type: "response_item",
  payload: { type: "message", role: "assistant", content: [] },
});
const codexError = (minute: number, info: unknown) => ({
  timestamp: at(minute),
  type: "event_msg",
  payload: { type: "error", message: "SYNTHETIC", codex_error_info: info },
});

test("a Codex rollout ending with a reached limit is a stop with its reset", () => {
  expect(
    usageStopFromRecords("codex", [
      codexAnswer(0),
      codexLimits(1, null, 80),
      codexUser(2),
      codexLimits(3, "primary"),
    ]),
  ).toEqual({
    harness: "codex",
    at: Date.parse(at(3)),
    resets_at: reset * 1000,
  });
});

test("an unnamed reached type takes the reset of a used-up window", () => {
  expect(
    usageStopFromRecords("codex", [codexLimits(3, "rate_limit_reached")])
      ?.resets_at,
  ).toBe(reset * 1000);
  // No window at 100 %: the stop has no reset time.
  expect(
    usageStopFromRecords("codex", [codexLimits(3, "workspace_credits", 60)]),
  ).toEqual({ harness: "codex", at: Date.parse(at(3)), resets_at: null });
});

test("Codex's own usage-limit error is a stop, other errors are not", () => {
  expect(
    usageStopFromRecords("codex", [
      codexLimits(1, null),
      codexError(2, "usage_limit_exceeded"),
    ]),
  ).toEqual({
    harness: "codex",
    at: Date.parse(at(2)),
    resets_at: reset * 1000,
  });
  expect(
    usageStopFromRecords("codex", [codexError(2, "context_window_exceeded")]),
  ).toBeNull();
});

test("a Codex agent that acts again, or reports a level below its limit, has fuel", () => {
  expect(
    usageStopFromRecords("codex", [codexLimits(3, "primary"), codexAnswer(4)]),
  ).toBeNull();
  expect(
    usageStopFromRecords("codex", [
      codexLimits(3, "primary"),
      codexLimits(4, null, 2),
    ]),
  ).toBeNull();
  // The owner typing again is not the agent acting.
  expect(
    usageStopFromRecords("codex", [codexLimits(3, "primary"), codexUser(4)]),
  ).not.toBeNull();
});

const claudeAnswer = (minute: number) => ({
  type: "assistant",
  timestamp: at(minute),
  message: {
    model: "claude-synthetic",
    content: [{ type: "text", text: "ok" }],
  },
});
const claudeRefusal = (
  minute: number,
  extra: Record<string, unknown>,
  text = "SYNTHETIC",
) => ({
  type: "assistant",
  timestamp: at(minute),
  isApiErrorMessage: true,
  message: { model: "<synthetic>", content: [{ type: "text", text }] },
  ...extra,
});

test("a Claude transcript ending with a limit refusal is a stop with its reset", () => {
  expect(
    usageStopFromRecords("claude", [
      claudeAnswer(0),
      { type: "user", timestamp: at(1), message: { content: "go on" } },
      claudeRefusal(2, {
        error: "rate_limit",
        apiError: "usage_limit_reached",
        apiErrorParams: {
          rate_limit_info: { resetsAt: reset, rateLimitType: "five_hour" },
        },
      }),
    ]),
  ).toEqual({
    harness: "claude",
    at: Date.parse(at(2)),
    resets_at: reset * 1000,
  });
});

test("Claude's limit messages carry the reset they state", () => {
  expect(
    usageStopFromRecords("claude", [
      claudeRefusal(2, {}, `Claude AI usage limit reached|${reset}`),
    ])?.resets_at,
  ).toBe(reset * 1000);
  const textReset = (text: string, minute = 2) =>
    usageStopFromRecords("claude", [
      claudeRefusal(minute, { error: "rate_limit" }, text),
    ])?.resets_at;
  expect(
    usageStopFromRecords("claude", [
      claudeRefusal(
        2,
        { error: "rate_limit" },
        "You've hit your limit · resets 3pm (UTC)",
      ),
    ]),
  ).toEqual({
    harness: "claude",
    at: Date.parse(at(2)),
    resets_at: reset * 1000,
  });
  // The zone's own wall clock: 10:30 in New York is 15:30 UTC in November.
  expect(
    textReset(
      "Claude usage limit reached. Your limit will reset at 10:30am (America/New_York).",
    ),
  ).toBe(Date.UTC(2026, 10, 7, 15, 30));
  // A time already past today is tomorrow's; a stated date is used as given.
  expect(textReset("You've hit your limit · resets 9am (UTC)")).toBe(
    Date.UTC(2026, 10, 8, 9, 0),
  );
  expect(textReset("Weekly limit reached · resets Nov 10, 9am (UTC)")).toBe(
    Date.UTC(2026, 10, 10, 9, 0),
  );
  // Without a zone the time is the service's own.
  const local = new Date(Date.parse(at(2)));
  const expected = new Date(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    23,
    59,
  ).getTime();
  expect(textReset("You've hit your limit · resets 11:59pm")).toBe(
    expected > local.getTime() ? expected : expected + 86_400_000,
  );
  // No time, or a zone nobody knows: limit reached, with no reset.
  expect(textReset("You've hit your limit")).toBeNull();
  expect(
    textReset("You've hit your limit · resets 3pm (Nowhere/Atlantis)"),
  ).toBeNull();
});

test("a reset in a repeated or skipped hour is the first match after the refusal", () => {
  // New York's clocks went back at 2am EDT on 1 November 2026, so 1:30am
  // happened twice: 05:30 UTC (EDT), then 06:30 UTC (EST).
  const resetAt = (
    refusal: number,
    text = "resets 1:30am (America/New_York)",
  ) =>
    usageStopFromRecords("claude", [
      claudeRefusal(
        0,
        { error: "rate_limit", timestamp: new Date(refusal).toISOString() },
        `You've hit your limit · ${text}`,
      ),
    ])?.resets_at;
  expect(resetAt(Date.UTC(2026, 10, 1, 5, 10))).toBe(
    Date.UTC(2026, 10, 1, 5, 30),
  );
  expect(resetAt(Date.UTC(2026, 10, 1, 5, 40))).toBe(
    Date.UTC(2026, 10, 1, 6, 30),
  );
  expect(resetAt(Date.UTC(2026, 10, 1, 6, 10))).toBe(
    Date.UTC(2026, 10, 1, 6, 30),
  );
  expect(resetAt(Date.UTC(2026, 10, 1, 6, 40))).toBe(
    Date.UTC(2026, 10, 2, 6, 30),
  );
  expect(
    resetAt(
      Date.UTC(2026, 9, 31, 12, 0),
      "resets Nov 1, 1:30am (America/New_York)",
    ),
  ).toBe(Date.UTC(2026, 10, 1, 5, 30));
  expect(
    resetAt(
      Date.UTC(2026, 10, 1, 5, 40),
      "resets Nov 1, 1:30am (America/New_York)",
    ),
  ).toBe(Date.UTC(2026, 10, 1, 6, 30));
  // 2:30am never happened on 8 March 2026: the clock read 3:30am EDT then.
  expect(
    resetAt(Date.UTC(2026, 2, 8, 6, 0), "resets 2:30am (America/New_York)"),
  ).toBe(Date.UTC(2026, 2, 8, 7, 30));
});

test("other Claude errors are not stops, and a later answer ends one", () => {
  expect(
    usageStopFromRecords("claude", [
      claudeRefusal(2, { error: "rate_limit" }, "API Error: 529 overloaded"),
    ]),
  ).toBeNull();
  expect(
    usageStopFromRecords("claude", [
      claudeRefusal(2, { apiError: "usage_limit_reached" }),
      claudeAnswer(3),
    ]),
  ).toBeNull();
  expect(
    usageStopFromRecords("pi", [
      claudeRefusal(2, { apiError: "usage_limit_reached" }),
    ]),
  ).toBeNull();
});

test("a stop holds until its reset and reads the same words everywhere", () => {
  const stop = { harness: "codex" as const, at: 0, resets_at: reset * 1000 };
  expect(usageStopCurrent(stop, reset * 1000 - 1)).toBe(true);
  expect(usageStopCurrent(stop, reset * 1000)).toBe(false);
  expect(usageStopCurrent({ ...stop, resets_at: null }, 8e12)).toBe(true);
  expect(usageStopCurrent(null, 0)).toBe(false);
  const local = new Date(2026, 10, 7, 15, 0).getTime();
  expect(
    usageStopText(
      { ...stop, resets_at: local },
      new Date(2026, 10, 7, 12).getTime(),
    ),
  ).toBe("Usage limit reached · resets 15:00 (Codex)");
  expect(
    usageStopText(
      {
        harness: "claude",
        at: 0,
        resets_at: new Date(2026, 10, 10, 9, 5).getTime(),
      },
      new Date(2026, 10, 7, 12).getTime(),
    ),
  ).toBe("Usage limit reached · resets Tue 09:05 (Claude)");
  expect(usageStopText({ ...stop, resets_at: null }, 0)).toBe(
    "Usage limit reached (Codex)",
  );
});
