import { expect, test } from "bun:test";
import {
  AGENT_START_KEEP_MS,
  agentStarts,
  launchConfirmedTerminal,
  noteAgentStarted,
  resetAgentStarts,
} from "./agentStarts";

test("only a confirmed start with its terminal counts as started", () => {
  expect(launchConfirmedTerminal({ status: "sent", terminal_id: "t" })).toBe(
    "t",
  );
  expect(launchConfirmedTerminal({ status: "started", terminal_id: "t" })).toBe(
    "t",
  );
  expect(launchConfirmedTerminal({ status: "started" })).toBeNull();
  expect(
    launchConfirmedTerminal({ status: "failed", terminal_id: "t" }),
  ).toBeNull();
  expect(
    launchConfirmedTerminal({ status: "uncertain", terminal_id: "t" }),
  ).toBeNull();
});

test("noted starts are page memory with unique ids, and old ones are let go", () => {
  resetAgentStarts();
  const base = {
    connectionId: "c",
    generation: 1,
    from: "center",
  } as const;
  noteAgentStarted({ ...base, terminalId: "a" }, 0);
  noteAgentStarted({ ...base, terminalId: "b" }, 10);
  const [a, b] = agentStarts();
  expect([a!.terminalId, b!.terminalId]).toEqual(["a", "b"]);
  expect(a!.id).not.toBe(b!.id);
  noteAgentStarted({ ...base, terminalId: "c" }, AGENT_START_KEEP_MS + 5);
  expect(agentStarts().map((start) => start.terminalId)).toEqual(["b", "c"]);
  resetAgentStarts();
});
