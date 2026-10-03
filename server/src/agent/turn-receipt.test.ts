import { describe, expect, test } from "bun:test";
import type { AtifStep, AtifTrajectory, SessionFile } from "./session-types";
import { latestTurnReceipt } from "./turn-receipt";

const file: SessionFile = { path: "/sessions/example.jsonl", mtimeMs: 0 };

function trajectory(steps: Omit<AtifStep, "step_id">[]): AtifTrajectory {
  return {
    schema_version: "ATIF-v1.7",
    agent: { name: "claude", version: "1" },
    steps: steps.map((step, index) => ({ ...step, step_id: index })),
  };
}

const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 9, minute)).toISOString();

describe("latestTurnReceipt", () => {
  test("summarizes only the work after the latest user message", () => {
    const receipt = latestTurnReceipt(
      file,
      trajectory([
        { source: "user", message: "Old request", timestamp: at(0) },
        { source: "agent", message: "Old report", timestamp: at(1) },
        { source: "user", message: "Add retry backoff", timestamp: at(10) },
        {
          source: "agent",
          message: "Tool call: Edit",
          timestamp: at(12),
          tool_calls: [
            {
              tool_call_id: "1",
              function_name: "Edit",
              arguments: { file_path: "src/retry.ts" },
            },
            {
              tool_call_id: "2",
              function_name: "Bash",
              arguments: { command: "bun test" },
            },
          ],
        },
        { source: "system", message: "ok", timestamp: at(13) },
        { source: "agent", message: "Reasoning", timestamp: at(14) },
        {
          source: "agent",
          message: "Added backoff; tests pass.",
          timestamp: at(16),
        },
        { source: "system", message: "hook", timestamp: at(55) },
      ]),
    );
    expect(receipt).toMatchObject({
      turn_id: "example.jsonl:2..7",
      ask: "Add retry backoff",
      report: "Added backoff; tests pass.",
      started_at: at(10),
      ended_at: at(16),
      duration_ms: 6 * 60_000,
      tool_calls: 2,
      commands: 1,
      files: ["src/retry.ts"],
      files_truncated: false,
    });
  });

  test("reads patch headers from shell commands", () => {
    const receipt = latestTurnReceipt(
      file,
      trajectory([
        { source: "user", message: "Fix the parser", timestamp: at(0) },
        {
          source: "agent",
          message: "Tool call: exec",
          timestamp: at(1),
          tool_calls: [
            {
              tool_call_id: "1",
              function_name: "exec",
              arguments: {
                value:
                  "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/parse.ts\n*** Add File: src/parse.test.ts\n*** End Patch\nEOF",
              },
            },
          ],
        },
      ]),
    );
    expect(receipt?.files).toEqual(["src/parse.ts", "src/parse.test.ts"]);
    expect(receipt?.report).toBeNull();
    expect(receipt?.commands).toBe(1);
  });

  test("names each stop within one user turn separately", () => {
    const base: Omit<AtifStep, "step_id">[] = [
      { source: "user", message: "Ship it", timestamp: at(0) },
      { source: "agent", message: "Allow push?", timestamp: at(1) },
    ];
    const first = latestTurnReceipt(file, trajectory(base));
    const second = latestTurnReceipt(
      file,
      trajectory([
        ...base,
        { source: "agent", message: "Pushed.", timestamp: at(2) },
      ]),
    );
    expect(first?.turn_id).not.toBe(second?.turn_id);
    expect(second?.report).toBe("Pushed.");
  });

  test("bounds long text and file lists", () => {
    const receipt = latestTurnReceipt(
      file,
      trajectory([
        { source: "user", message: "x".repeat(2_000) },
        {
          source: "agent",
          message: "Tool call: Write",
          tool_calls: Array.from({ length: 30 }, (_, index) => ({
            tool_call_id: String(index),
            function_name: "Write",
            arguments: { file_path: `src/file-${index}.ts` },
          })),
        },
        { source: "agent", message: "y".repeat(5_000) },
      ]),
    );
    expect([...(receipt?.ask ?? "")].length).toBe(600);
    expect([...(receipt?.report ?? "")].length).toBe(2_400);
    expect(receipt?.report_truncated).toBe(true);
    expect(receipt?.files).toHaveLength(24);
    expect(receipt?.files_truncated).toBe(true);
    expect(receipt?.duration_ms).toBeNull();
  });

  test("drops harness wrapper tags but keeps paragraphs", () => {
    const receipt = latestTurnReceipt(
      file,
      trajectory([
        {
          source: "user",
          message: '<pasted_content id="a1">Review   the plan</pasted_content>',
        },
        { source: "agent", message: "First point.\n\n\n\nSecond point." },
      ]),
    );
    expect(receipt?.ask).toBe("Review the plan");
    expect(receipt?.report).toBe("First point.\n\nSecond point.");
  });

  test("returns null for an empty session", () => {
    expect(latestTurnReceipt(file, trajectory([]))).toBeNull();
  });
});
