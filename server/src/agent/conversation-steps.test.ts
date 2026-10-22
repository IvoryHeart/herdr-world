import { describe, expect, test } from "bun:test";
import {
  parseTestStrip,
  stepDiff,
  stepsFromEntries,
} from "./conversation-steps";
import type { HistoryEntry } from "./session-history";

// Synthetic transcripts and runner output only.

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 22, 9, 0, clock++)).toISOString();
const call = (id: string, name: string, input: unknown): HistoryEntry => ({
  id: `call:${id}`,
  role: "tool",
  kind: "tool_call",
  text: JSON.stringify(input),
  sent_at: at(),
  tool_name: name,
  source_call_id: id,
});
const result = (id: string, output: string, isError = false): HistoryEntry => ({
  id: `result:${id}`,
  role: "tool",
  kind: "tool_result",
  text: output,
  sent_at: at(),
  source_call_id: id,
  ...(isError ? { is_error: true } : {}),
});
const said = (text: string): HistoryEntry => ({
  id: `said:${clock}`,
  role: "assistant",
  kind: "message",
  text,
  sent_at: at(),
});

describe("steps from a transcript", () => {
  test("each call is a step keyed by its tool-call ID, with its evidence", () => {
    const steps = stepsFromEntries([
      call("t1", "Read", { file_path: "server/src/link/reconnect.ts" }),
      result("t1", "export function nextDelay() {}"),
      call("t2", "Edit", {
        file_path: "server/src/link/reconnect.ts",
        old_string: "  return 1000;",
        new_string: "  const base = 500;\n  return base;",
      }),
      result("t2", "The file has been updated."),
      call("t3", "Bash", {
        command: "bun test server/src/link",
        description: "Run reconnect tests",
      }),
      result(
        "t3",
        "reconnect.test.ts:\n(fail) backs off to the cap [0.84ms]\n 12 pass\n 1 fail",
      ),
    ]);
    expect(steps.map((step) => [step.id, step.label, step.state])).toEqual([
      ["t1", "Read reconnect.ts", "ok"],
      ["t2", "Edit reconnect.ts", "ok"],
      ["t3", "Run reconnect tests", "failed"],
    ]);
    expect(steps[1]!.diff).toEqual({
      file: "server/src/link/reconnect.ts",
      removed: ["  return 1000;"],
      added: ["  const base = 500;", "  return base;"],
      truncated: false,
    });
    expect(steps[2]!.input_summary).toBe("bun test server/src/link");
    expect(steps[2]!.test).toEqual({
      runner: "bun",
      passed: 12,
      failed: 1,
      first_failure: "backs off to the cap",
    });
    expect(steps[2]!.ended_at).not.toBeNull();
  });

  test("an open call is running; one followed by more is interrupted", () => {
    const running = stepsFromEntries([
      call("r1", "Bash", { command: "bun test" }),
    ]);
    expect(running[0]).toMatchObject({ state: "running", ended_at: null });
    const interrupted = stepsFromEntries([
      call("i1", "Bash", { command: "sleep 100" }),
      said("Stopped; what next?"),
    ]);
    expect(interrupted[0]!.state).toBe("interrupted");
  });

  test("an error result fails the step and keeps its tail", () => {
    const [step] = stepsFromEntries([
      call("e1", "Bash", { command: "cat missing.txt" }),
      result("e1", "cat: missing.txt: No such file or directory", true),
    ]);
    expect(step).toMatchObject({
      state: "failed",
      result_tail: "cat: missing.txt: No such file or directory",
    });
  });

  test("result tails are bounded and credentials redacted", () => {
    const output = Array.from({ length: 40 }, (_, n) => `line ${n}`).join("\n");
    const [step] = stepsFromEntries([
      call("b1", "Bash", { command: "env | head" }),
      result(
        "b1",
        `${output}\nAPI_KEY=abcdef1234567890 token: ghp_abcdefghijklmnop`,
      ),
    ]);
    const lines = step!.result_tail!.split("\n");
    expect(lines.length).toBe(12);
    expect(step!.result_tail).not.toContain("abcdef1234567890");
    expect(step!.result_tail).not.toContain("ghp_abcdefghijklmnop");
  });

  test("a call without an ID still gets a stable step ID", () => {
    const entry = { ...call("x", "Grep", { pattern: "nextDelay" }) };
    delete entry.source_call_id;
    const [step] = stepsFromEntries([entry]);
    expect(step).toMatchObject({
      id: "entry:call:x",
      call_id: null,
      label: "Search nextDelay",
    });
  });
});

describe("diffs", () => {
  test("MultiEdit joins its edits; Write is all added", () => {
    expect(
      stepDiff("MultiEdit", {
        file_path: "a.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      }),
    ).toMatchObject({ removed: ["a", "c"], added: ["b", "d"] });
    expect(
      stepDiff("Write", { file_path: "new.md", content: "# Notes\nhi" }),
    ).toMatchObject({ removed: [], added: ["# Notes", "hi"] });
  });

  test("a large edit is cut and says so", () => {
    const big = Array.from({ length: 100 }, (_, n) => `x${n}`).join("\n");
    const diff = stepDiff("Edit", {
      file_path: "big.ts",
      old_string: big,
      new_string: big,
    })!;
    expect(diff.truncated).toBe(true);
    expect(diff.removed.length + diff.added.length).toBeLessThanOrEqual(40);
  });

  test("other tools have no diff", () => {
    expect(stepDiff("Read", { file_path: "a.ts" })).toBeNull();
  });
});

describe("test strips", () => {
  test.each([
    [
      "vitest",
      " FAIL  src/a.test.ts > adds\n Tests  1 failed | 12 passed (13)",
      { runner: "vitest", passed: 12, failed: 1 },
    ],
    [
      "jest",
      "  ● Retry › backs off\nTests:       1 failed, 12 passed, 13 total",
      {
        runner: "jest",
        passed: 12,
        failed: 1,
        first_failure: "Retry › backs off",
      },
    ],
    [
      "pytest",
      "FAILED tests/test_retry.py::test_cap - assert 31544 <= 30000\n===== 1 failed, 12 passed in 0.84s =====",
      {
        runner: "pytest",
        passed: 12,
        failed: 1,
        first_failure: "tests/test_retry.py::test_cap",
      },
    ],
    [
      "cargo",
      "test retry::cap ... FAILED\ntest result: FAILED. 12 passed; 1 failed; 0 ignored",
      { runner: "cargo", passed: 12, failed: 1, first_failure: "retry::cap" },
    ],
    [
      "bun, all green",
      " 13 pass\n 0 fail",
      { runner: "bun", passed: 13, failed: 0 },
    ],
  ])("%s", (_name, output, expected) => {
    expect(parseTestStrip(output)).toMatchObject(expected);
  });

  test("output that is not a test summary has no strip", () => {
    expect(parseTestStrip("Compiled 42 files in 1.2s")).toBeNull();
  });
});
