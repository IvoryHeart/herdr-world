import { expect, test } from "bun:test";
import { lastProgress } from "./progress";
import { NOW } from "../gate/cases";

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
