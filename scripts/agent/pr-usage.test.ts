import { expect, test } from "bun:test";
import { summarizeTooling, summarizeUsage } from "./pr-usage";

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

test("reports bounded aggregate tool activity without exposing commands or output", () => {
  const timestamp = "2026-09-25T11:00:00.000Z";
  const item = (payload: Record<string, unknown>, at = timestamp) =>
    JSON.stringify({ timestamp: at, type: "response_item", payload });
  const command = (value: string) =>
    `tools.exec_command({cmd:${JSON.stringify(value)}})`;
  const logs = [
    {
      sessionId: "root",
      lines: [
        item(
          {
            type: "custom_tool_call",
            name: "exec",
            input: command("bun run check"),
          },
          "2026-09-25T10:00:00.000Z",
        ),
        item({
          type: "custom_tool_call",
          name: "exec",
          input: `await Promise.all([${command("bun test web/src/example.test.ts")}, ${command("bun run typecheck:quick")}])`,
        }),
        item({
          type: "custom_tool_call",
          name: "exec",
          input: command("npm exec --yes bun@1.4.1 -- run check"),
        }),
        item({
          type: "custom_tool_call",
          name: "exec",
          input: command("gh pr view 111 --json headRefOid"),
        }),
        item({
          type: "custom_tool_call_output",
          output: [
            { type: "text", text: "x".repeat(10_001) },
            { type: "text", text: "secret.example" },
          ],
        }),
      ].join("\n"),
    },
    {
      sessionId: "child",
      lines: item({ type: "function_call", name: "send_message" }),
    },
  ];
  const summary = summarizeTooling(
    logs,
    "2026-09-25T11:00:00.000Z",
    "2026-09-25T12:00:00.000Z",
  );
  expect(summary).toEqual({
    outerCalls: 4,
    execWrappers: 3,
    singleNestedExecWrappers: 2,
    nestedCalls: 4,
    testCommands: 1,
    quickTypechecks: 1,
    fullChecks: 1,
    githubCommands: 1,
    outputChars: 10_015,
    largeOutputs: 1,
  });
  expect(JSON.stringify(summary)).not.toContain("secret.example");
});

test("counts executed checks without counting heredoc, quoted, or comment text", () => {
  const timestamp = "2026-09-25T11:00:00.000Z";
  const command = (value: string) =>
    JSON.stringify({
      timestamp,
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        input: `tools.exec_command({cmd:${JSON.stringify(value)}})`,
      },
    });
  const summary = summarizeTooling([
    {
      sessionId: "review",
      lines: [
        command(
          "gh api repos/example/project/pulls/1/comments -f body=@- <<'REVIEW'\n" +
            "I did not run bun run check, bun test, or gh pr view.\n" +
            "REVIEW\n" +
            "printf '%s\\n' 'bun run check' \"bun test\" # bun run typecheck:quick\n" +
            "CI=1 bun run check > /tmp/check.log 2>&1",
        ),
        command(
          "cat <<EOF > /tmp/review.txt\n" +
            "bun run check\n" +
            "EOF\n" +
            "bun test scripts/agent/pr-usage.test.ts",
        ),
      ].join("\n"),
    },
  ]);
  expect(summary.fullChecks).toBe(1);
  expect(summary.testCommands).toBe(1);
  expect(summary.quickTypechecks).toBe(0);
  expect(summary.githubCommands).toBe(1);
});
