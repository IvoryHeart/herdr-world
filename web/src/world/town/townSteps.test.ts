import { expect, test } from "bun:test";
import {
  TOWN_STEP_LONG_MS,
  townStepAge,
  townStepKind,
  townStepLabel,
  townStepLong,
  townStepOf,
  townStepWords,
  type TownStep,
} from "./townSteps";

test("Claude Code's tools map to step kinds", () => {
  expect(townStepKind("Edit", "src/login.ts")).toBe("edit");
  expect(townStepKind("MultiEdit", null)).toBe("edit");
  expect(townStepKind("Write", null)).toBe("edit");
  expect(townStepKind("NotebookEdit", null)).toBe("edit");
  expect(townStepKind("Read", "src/login.ts")).toBe("read");
  expect(townStepKind("Grep", "redirect")).toBe("read");
  expect(townStepKind("Glob", "**/*.ts")).toBe("read");
  expect(townStepKind("WebFetch", "https://example.com")).toBe("web");
  expect(townStepKind("WebSearch", "bun test")).toBe("web");
  expect(townStepKind("Task", "Find the callers")).toBe("agent");
  expect(townStepKind("Agent", null)).toBe("agent");
  expect(townStepKind("TodoWrite", null)).toBe("think");
  // Bash's summary is its description first, else its command.
  expect(townStepKind("Bash", "Run the focused tests")).toBe("test");
  expect(townStepKind("Bash", "bun test web/src/login.test.ts")).toBe("test");
  expect(townStepKind("Bash", "Build the site")).toBe("command");
  expect(townStepKind("Bash", "rg --max-count 5 redirect web/src")).toBe(
    "read",
  );
  expect(townStepKind("Bash", null)).toBe("command");
});

test("Codex's and Pi's tools map to step kinds", () => {
  expect(townStepKind("apply_patch", null)).toBe("edit");
  expect(townStepKind("exec_command", null)).toBe("command");
  expect(townStepKind("shell", "cargo test --workspace")).toBe("test");
  expect(townStepKind("shell", "pytest -q tests")).toBe("test");
  expect(townStepKind("shell", "sed -n '1,40p' src/main.rs")).toBe("read");
  expect(townStepKind("web_search", "release notes")).toBe("web");
  expect(townStepKind("update_plan", null)).toBe("think");
  expect(townStepKind("spawn_agent", null)).toBe("agent");
  // Pi
  expect(townStepKind("bash", "npm run test:unit")).toBe("test");
  expect(townStepKind("read", "README.md")).toBe("read");
  expect(townStepKind("edit", "README.md")).toBe("edit");
  expect(townStepKind("write", "notes.md")).toBe("edit");
});

test("a word that only contains 'test' is not a test run", () => {
  expect(townStepKind("Bash", "git fetch origin latest")).toBe("command");
  expect(townStepKind("Bash", "bun run typecheck:quick")).toBe("command");
  expect(townStepKind("Bash", "gh attest verify")).toBe("command");
});

test("a shell step is classed by the operation it runs, not by its arguments", () => {
  // Reading or searching test files is reading.
  expect(townStepKind("Bash", "cat web/src/login.test.ts")).toBe("read");
  expect(townStepKind("Bash", "sed -n 1,100p web/src/login.test.ts")).toBe(
    "read",
  );
  expect(townStepKind("Bash", "rg tests web/src")).toBe("read");
  expect(townStepKind("shell", "cd web && grep -rn jest src")).toBe("read");
  expect(townStepKind("Bash", "ls tests/")).toBe("read");
  // Running tests, however launched.
  expect(townStepKind("Bash", "bun run test web/src/login.test.ts")).toBe(
    "test",
  );
  expect(townStepKind("Bash", "cd web && npx vitest run")).toBe("test");
  expect(townStepKind("shell", "python -m pytest tests -q")).toBe("test");
  expect(townStepKind("shell", "go test ./...")).toBe("test");
  expect(townStepKind("Bash", "CI=1 timeout 600 make test 2>&1 | tail")).toBe(
    "test",
  );
  expect(townStepKind("Bash", "./node_modules/.bin/jest login")).toBe("test");
  expect(townStepKind("Bash", "bun run typecheck:quick && bun test")).toBe(
    "test",
  );
  // A command that only mentions tests, and other shell work.
  expect(townStepKind("Bash", "git add web/src/login.test.ts")).toBe("command");
  expect(townStepKind("Bash", "test -f web/src/login.ts")).toBe("command");
  expect(townStepKind("Bash", "sed -i s/a/b/ login.test.ts")).toBe("command");
  expect(townStepKind("Bash", "Show the login tests")).toBe("command");
});

test("a tool Town does not know is working with no glyph", () => {
  expect(townStepKind("mcp__example__lookup", "x")).toBeNull();
  expect(townStepKind("SomethingNew", null)).toBeNull();
});

const conversation = (
  fields: Partial<Parameters<typeof townStepOf>[0]> = {},
): Parameters<typeof townStepOf>[0] => ({
  status: "ok",
  agent: "claude",
  agent_status: "working",
  terminal_title: "✳ Fix login redirect",
  running_tool: {
    name: "Bash",
    summary: "Run the unit tests",
    started_at: "2026-11-08T10:00:00.000Z",
  },
  ...fields,
});

test("a step is the open tool call and the title's task, as Chat's Now bar reads them", () => {
  expect(townStepOf(conversation())).toEqual({
    kind: "test",
    since: Date.parse("2026-11-08T10:00:00.000Z"),
    task: "Fix login redirect",
  });
  // No open call: a known harness is thinking or writing, with no timer.
  expect(townStepOf(conversation({ running_tool: null }))).toEqual({
    kind: "think",
    since: null,
    task: "Fix login redirect",
  });
  expect(
    townStepOf(conversation({ terminal_title: null, running_tool: null })),
  ).toEqual({ kind: "think", since: null, task: null });
});

test("harnesses whose steps Chat does not read, unreadable transcripts and unknown tools show no step", () => {
  expect(townStepOf(conversation({ agent: "grok" }))).toBeNull();
  expect(townStepOf(conversation({ agent: null }), "kimi")).toBeNull();
  expect(townStepOf(conversation({ agent: null }), "codex")?.kind).toBe("test");
  expect(townStepOf(conversation({ status: "unavailable" }))).toBeNull();
  expect(
    townStepOf(
      conversation({
        running_tool: {
          name: "mcp__example__lookup",
          summary: null,
          started_at: "2026-11-08T10:00:00.000Z",
        },
      }),
    ),
  ).toBeNull();
});

const step = (kind: TownStep["kind"], minutes: number | null): TownStep => ({
  kind,
  since: minutes === null ? null : NOW - minutes * 60_000,
  task: "Fix login redirect",
});
const NOW = Date.parse("2026-11-08T12:00:00.000Z");

test("a step is long once it passes its kind's threshold", () => {
  expect(townStepLong(step("test", 9.9), NOW)).toBe(false);
  expect(townStepLong(step("test", 10), NOW)).toBe(true);
  expect(townStepLong(step("test", 14), NOW)).toBe(true);
  expect(townStepLong(step("command", 9), NOW)).toBe(false);
  expect(townStepLong(step("command", 12), NOW)).toBe(true);
  expect(townStepLong(step("edit", 2), NOW)).toBe(false);
  expect(townStepLong(step("edit", 3), NOW)).toBe(true);
  expect(townStepLong(step("read", 5), NOW)).toBe(true);
  expect(townStepLong(step("web", 4), NOW)).toBe(false);
  expect(townStepLong(step("agent", 19), NOW)).toBe(false);
  expect(townStepLong(step("agent", 20), NOW)).toBe(true);
  // Thinking has no timer.
  expect(townStepLong(step("think", null), NOW)).toBe(false);
  expect(TOWN_STEP_LONG_MS.think).toBe(Infinity);
});

test("ages are whole minutes, then hours", () => {
  expect(townStepAge(step("test", 0.5), NOW)).toBeNull();
  expect(townStepAge(step("test", 14.6), NOW)).toBe("14m");
  expect(townStepAge(step("agent", 65), NOW)).toBe("1h 05m");
  expect(townStepAge(step("think", null), NOW)).toBeNull();
});

test("a bubble's words are the task and the step with its timer", () => {
  expect(townStepWords(step("test", 3), NOW)).toBe(
    "Fix login redirect · tests 3m",
  );
  expect(townStepLabel(step("edit", 0), NOW)).toBe("editing");
  expect(townStepWords({ ...step("think", null), task: null }, NOW)).toBe(
    "thinking",
  );
});
