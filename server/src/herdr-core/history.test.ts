import { expect, test } from "bun:test";
import { localAgentSessionFiles } from "../agent/session-file-access";
import { coreHarnessNames, harnessName } from "./harness";
import { argvSession, processSession } from "./history";
import inventory from "./testing/harness-inventory.json";

/**
 * How a core agent's terminal names its harness session. Chat reads it
 * through the shared handlers (agent-sessions.test.ts covers that path).
 */

const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

test("core catalog equals the raw TUI, desktop and World inventory union", () => {
  const names = [
    ...inventory.world_profiles,
    ...inventory.tui_detection,
    ...inventory.desktop_agents,
  ].map(harnessName);
  expect(names).not.toContain(null);
  expect(coreHarnessNames().sort()).toEqual(
    [...new Set(names.filter((name): name is string => name !== null))].sort(),
  );
});

test("launch arguments name a session only through each harness's verified flags", () => {
  const cases: [string, unknown[], unknown][] = [
    ["claude", ["claude", "--resume", SESSION], { kind: "id", value: SESSION }],
    [
      "claude",
      ["claude", `--session-id=${SESSION}`],
      { kind: "id", value: SESSION },
    ],
    [
      "claude",
      ["claude", "--resume", "/work/example/chat.jsonl"],
      { kind: "path", value: "/work/example/chat.jsonl" },
    ],
    [
      "pi",
      ["pi", "--session", "/work/example/pi.jsonl"],
      { kind: "path", value: "/work/example/pi.jsonl" },
    ],
    ["pi", ["pi", "--session-id", SESSION], { kind: "id", value: SESSION }],
    ["kimi", ["kimi", "--session", SESSION], { kind: "id", value: SESSION }],
    ["omp", ["omp", "--resume", SESSION], { kind: "id", value: SESSION }],
    ["codex", ["codex", "resume", SESSION], { kind: "id", value: SESSION }],
    // Another harness's flag, a flag with no value, or a following flag is no evidence.
    ["kimi", ["kimi", "--resume", SESSION], undefined],
    ["claude", ["claude", "--resume"], undefined],
    ["claude", ["claude", "--resume", "--verbose"], undefined],
    ["gemini", ["gemini", "--resume", SESSION], undefined],
    // The program name itself is never a flag.
    ["claude", ["--resume", SESSION], undefined],
  ];
  for (const [agent, argv, expected] of cases)
    expect(argvSession(agent, argv)).toEqual(expected as never);
  expect(argvSession("claude", undefined)).toBeUndefined();
});

test("only Claude's own foreground process record names its session; a failed read is no evidence", async () => {
  const lookups: number[] = [];
  const files = (found: string | Error | null) => ({
    ...localAgentSessionFiles,
    findClaudeSessionForProcess: async (pid: number) => {
      lookups.push(pid);
      if (found instanceof Error) throw found;
      return found;
    },
  });
  const claude = { pid: 77, name: "claude", argv: ["claude"] };
  expect(await processSession("claude", claude, files(SESSION))).toEqual({
    kind: "id",
    value: SESSION,
  });
  // A wrapper leading the process group is not Claude.
  expect(
    await processSession(
      "claude",
      { pid: 78, name: "sh", argv: ["sh", "-c", "claude"] },
      files(SESSION),
    ),
  ).toBeUndefined();
  expect(
    await processSession(
      "claude",
      claude,
      files(new Error("permission denied")),
    ),
  ).toBeUndefined();
  expect(await processSession("claude", claude, files(null))).toBeUndefined();
  expect(
    await processSession("codex", { pid: 79, name: "codex" }, files(SESSION)),
  ).toBeUndefined();
  expect(lookups).toEqual([77, 77, 77]);
});

test("headless agents use their own writable transcript on the agent host", async () => {
  const lookups: [string, number][] = [];
  const transcript = { kind: "path" as const, value: "/work/demo/live.jsonl" };
  const files = {
    ...localAgentSessionFiles,
    remote: true,
    findClaudeSessionForProcess: async () => null,
    findAgentSessionForProcess: async (agent: string, pid: number) => {
      lookups.push([agent, pid]);
      return transcript;
    },
  };
  for (const agent of ["codex", "claude"]) {
    expect(
      await processSession(
        agent,
        {
          pid: 77,
          name: agent,
          argv: [agent, agent === "codex" ? "exec" : "-p"],
        },
        files,
      ),
    ).toEqual(transcript);
    expect(
      await processSession(
        agent,
        { pid: 78, name: "sh", argv: ["sh", "-c", agent] },
        files,
      ),
    ).toBeUndefined();
  }
  expect(lookups).toEqual([
    ["codex", 77],
    ["claude", 77],
  ]);
});

test("process transcript lookup failure is no evidence", async () => {
  expect(
    await processSession(
      "codex",
      { pid: 77, name: "codex" },
      {
        ...localAgentSessionFiles,
        findAgentSessionForProcess: async () => {
          throw new Error("permission denied");
        },
      },
    ),
  ).toBeUndefined();
});

test("an explicitly named Claude debug file cannot claim its filename as the session ID", async () => {
  const files = {
    ...localAgentSessionFiles,
    findClaudeSessionForProcess: async () => null,
    findAgentSessionForProcess: async () => ({
      kind: "id" as const,
      value: SESSION,
    }),
  };
  for (const argv of [
    ["claude", "-p", "--debug-file", "/config/debug/other.txt"],
    ["claude", "-p", "--debug-file=/config/debug/other.txt"],
    undefined,
  ]) {
    expect(
      await processSession("claude", { pid: 77, name: "claude", argv }, files),
    ).toBeUndefined();
  }
  expect(
    await processSession(
      "claude",
      { pid: 77, name: "claude", argv: ["claude", "-p"] },
      files,
    ),
  ).toEqual({ kind: "id", value: SESSION });
});
