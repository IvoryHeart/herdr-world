import { expect, test } from "bun:test";
import { agentTitle, paneAgentName, paneAgentTitle } from "./agentName";

test("a title names who you talk to before what runs it", () => {
  expect(agentTitle("firstmate", "claude")).toBe("firstmate · claude");
  expect(agentTitle(undefined, "claude")).toBe("claude");
  expect(agentTitle("codex", "Codex")).toBe("codex");
  expect(agentTitle("  ", "")).toBe("");
});

test("a pane goes by its Herdr name, else its harness as before", () => {
  const pane = { agent: "claude", display_agent: "Claude" };
  expect(paneAgentName(pane)).toBe("Claude");
  expect(paneAgentName({ ...pane, agent_name: "rev1" })).toBe("rev1");
  expect(paneAgentTitle(pane)).toBe("claude");
  expect(paneAgentTitle({ ...pane, agent_name: "rev1" })).toBe("rev1 · claude");
});
