import { expect, test } from "bun:test";
import {
  parseHarnessReadiness,
  unknownHarnessReadiness,
} from "./harnessReadiness";

const complete = {
  ...unknownHarnessReadiness("codex", "complete", 1_700_000_000_000),
  installed: true,
  logged_in: true,
  can_log_in: true,
  method: "ChatGPT",
  probe: {
    source: "world-harness-probe",
    state: "ok",
    reason: "complete",
    observed_at: 1_700_000_000_000,
  },
};

test("wire accepts complete evidence but exposes only allowlisted metadata", () => {
  expect(parseHarnessReadiness("codex", complete)).toEqual(complete);
  const result = parseHarnessReadiness("codex", {
    ...complete,
    method: "private-account",
    email: "dev@example.com",
    stderr: "private-output",
    probe: { ...complete.probe, cwd: "/private" },
  });
  expect(result.method).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(/private|example.com|stderr|cwd/);
  expect(
    parseHarnessReadiness("codex", {
      ...complete,
      installed: false,
      logged_in: null,
    }).installed,
  ).toBe(false);
});

test("malformed, old and contradictory evidence cannot confirm absence/auth", () => {
  for (const value of [
    null,
    false,
    {},
    { kind: "codex", installed: false },
    { ...complete, kind: "claude" },
    { ...complete, logged_in: "true" },
    ...[null, -1, NaN, Infinity, 9_000_000_000_000_000].map((observed_at) => ({
      ...complete,
      probe: { ...complete.probe, observed_at },
    })),
    {
      ...complete,
      probe: { ...complete.probe, state: "ok", reason: "probe-failed" },
    },
    { ...complete, probe: { ...complete.probe, source: "private-account" } },
  ]) {
    const result = parseHarnessReadiness("codex", value);
    expect(result.installed).toBeNull();
    expect(result.logged_in).toBeNull();
    expect(result.can_log_in).toBe(false);
  }
  for (const reason of [
    "probe-failed",
    "timeout",
    "windows-unsupported",
  ] as const) {
    const result = parseHarnessReadiness("codex", {
      ...unknownHarnessReadiness("codex", reason, 123),
      installed: false,
      logged_in: false,
      can_log_in: true,
    });
    expect(result.installed).toBeNull();
    expect(result.logged_in).toBeNull();
    expect(result.can_log_in).toBe(false);
  }
});
