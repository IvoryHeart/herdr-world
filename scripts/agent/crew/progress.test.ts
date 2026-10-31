import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastProgress, readProgress } from "./progress";
import { findCodexSession } from "./worker";
import { addRun, getRun, openCrewStore } from "./store";
import { NOW, SHA } from "../gate/cases";

const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const line = (value: unknown) => JSON.stringify(value);

test.each(["claude", "codex"])(
  "%s conversation/tool events renew activity at their actual timestamp",
  (harness) => {
    const event =
      harness === "claude"
        ? {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "Bash",
                  input: { command: "bun run test" },
                },
              ],
            },
          }
        : {
            type: "response_item",
            payload: {
              type: "function_call",
              name: "exec_command",
              arguments: "{}",
            },
          };
    const text = line({ ...event, timestamp: at(89) });
    expect(lastProgress(text, harness, NOW, NOW + 90 * 60_000)).toBe(
      NOW + 89 * 60_000,
    );
    // Re-reading an old event at a later pass cannot refresh its timestamp.
    expect(lastProgress(text, harness, NOW, NOW + 179 * 60_000)).toBe(
      NOW + 89 * 60_000,
    );
  },
);

test("owner replies and tool results count as work", () => {
  expect(
    lastProgress(
      line({
        type: "user",
        timestamp: at(80),
        message: { content: "Continue checking that case" },
      }),
      "claude",
      NOW,
      NOW + 90 * 60_000,
    ),
  ).toBe(NOW + 80 * 60_000);
  for (const type of [
    "function_call_output",
    "custom_tool_call_output",
    "message",
  ])
    expect(
      lastProgress(
        line({
          type: "response_item",
          timestamp: at(85),
          payload: { type, output: "passed" },
        }),
        "codex",
        NOW,
        NOW + 90 * 60_000,
      ),
    ).toBe(NOW + 85 * 60_000);
});

test("metadata, heartbeats, token counters and malformed/future/old events do not renew activity", () => {
  const entries = [
    { type: "session_meta", timestamp: at(89), payload: { type: "message" } },
    { type: "turn_context", timestamp: at(89) },
    {
      type: "event_msg",
      timestamp: at(89),
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 99 } },
      },
    },
    { type: "event_msg", timestamp: at(89), payload: { type: "heartbeat" } },
    { type: "response_item", timestamp: at(100), payload: { type: "message" } },
    { type: "response_item", timestamp: at(-1), payload: { type: "message" } },
  ];
  const text = entries.map(line).join("\n") + '\n{"type":"response_item"';
  expect(lastProgress(text, "codex", NOW, NOW + 90 * 60_000)).toBeNull();
  expect(
    lastProgress(
      line({
        type: "progress",
        timestamp: at(89),
        message: { content: "heartbeat" },
      }),
      "claude",
      NOW,
      NOW + 90 * 60_000,
    ),
  ).toBeNull();
  expect(lastProgress(text, null, NOW, NOW + 90 * 60_000)).toBeNull();
});

test("a known active Codex session remains readable across three date folders", () => {
  const root = mkdtempSync(join(tmpdir(), "crew-progress-rollover-"));
  const db = openCrewStore(":memory:");
  const started = Date.parse("2026-01-01T23:59:00Z");
  const now = Date.parse("2026-01-03T00:00:00Z");
  const session = "00000000-0000-4000-8000-000000000001";
  const day = (name: string) => join(root, "2026", "01", name);
  try {
    mkdirSync(day("01"), { recursive: true });
    const text = line({
      timestamp: new Date(now).toISOString(),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "synthetic-call",
        output: "tests passed",
      },
    });
    writeFileSync(
      join(day("01"), `rollout-2026-01-01T23-59-00-${session}.jsonl`),
      line({
        type: "session_meta",
        payload: {
          id: session,
          cwd: root,
          timestamp: new Date(started).toISOString(),
        },
      }) +
        "\n" +
        text,
    );
    const id = addRun(
      db,
      {
        actionKey: "manual:synthetic",
        reviewer: "rev2",
        pr: 7,
        head: SHA.reviewed,
        log: "stdout",
      },
      started,
    );
    const run = { ...getRun(db, id)!, harness: "codex", session };
    expect(readProgress(run, root, now, { codex: root })).toBe(now);
    expect(findCodexSession(root, started, root)).toBe(session);
    mkdirSync(day("02"), { recursive: true });
    mkdirSync(day("03"), { recursive: true });
    expect(findCodexSession(root, started, root)).toBeNull();
    expect(readProgress(run, root, now, { codex: root })).toBe(now);
    expect(
      readProgress(
        { ...run, session: "00000000-0000-4000-8000-000000000002" },
        root,
        now,
        { codex: root },
      ),
    ).toBeNull();
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
