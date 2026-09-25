import { expect, test } from "bun:test";
import { summarizeUsage } from "./pr-usage";

function record(
  timestamp: string,
  responseId: string,
  input: number,
  cached: number,
  output: number,
  reasoning: number,
) {
  return JSON.stringify({
    timestamp,
    type: "token_usage_record",
    payload: {
      response_id: responseId,
      usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: input + output,
      },
    },
  });
}

test("sums per-response usage across sessions and includes compaction", () => {
  const first = [
    record("2026-09-25T10:00:00.000Z", "before", 500, 100, 50, 10),
    record("2026-09-25T11:00:00.000Z", "normal", 1000, 800, 100, 20),
    JSON.stringify({
      timestamp: "2026-09-25T11:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { total_tokens: 999999 } },
      },
    }),
    record("2026-09-25T11:02:00.000Z", "compaction", 300, 100, 60, 30),
  ].join("\n");
  const second = record("2026-09-25T11:03:00.000Z", "subagent", 200, 0, 40, 5);
  const summary = summarizeUsage(
    [
      { sessionId: "root", lines: first },
      { sessionId: "child", lines: second },
    ],
    "2026-09-25T11:00:00.000Z",
    "2026-09-25T12:00:00.000Z",
  );
  expect(summary).toEqual({
    responses: 3,
    input: 1500,
    cachedInput: 900,
    uncachedInput: 600,
    output: 200,
    reasoningOutput: 55,
    total: 1700,
    first: "2026-09-25T11:00:00.000Z",
    last: "2026-09-25T11:03:00.000Z",
  });
});

test("rejects duplicate response records and incomplete accounting", () => {
  const line = record("2026-09-25T11:00:00.000Z", "same", 100, 20, 30, 10);
  expect(() =>
    summarizeUsage([{ sessionId: "root", lines: `${line}\n${line}` }]),
  ).toThrow("Duplicate response");
  const invalid = JSON.parse(line);
  invalid.payload.usage.total_tokens = 1;
  expect(() =>
    summarizeUsage([{ sessionId: "root", lines: JSON.stringify(invalid) }]),
  ).toThrow("Incomplete token_usage_record");
});
