import { expect, test } from "bun:test";
import { agentName } from "./agentDisplayName";

const agent = (
  label: string,
  extra: { agent?: string; agentName?: string } = {},
) => agentName({ kind: "agent", label, agent: "claude", ...extra });

test("an agent reads <name>-<harness>, never doubling the harness", () => {
  expect(agent("otter")).toBe("otter-claude");
  expect(agent("lighthouse · claude", { agentName: "lighthouse" })).toBe(
    "lighthouse-claude",
  );
  expect(agent("lighthouse · claude")).toBe("lighthouse-claude");
  expect(agent("claude")).toBe("claude");
  expect(agent("otter-claude")).toBe("otter-claude");
  expect(agentName({ kind: "terminal", label: "shell" })).toBe("shell");
});
