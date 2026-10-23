import { expect, test } from "bun:test";
import {
  agentListRecord,
  agentTitle,
  paneAgentListing,
  paneAgentName,
  paneAgentTitle,
} from "./agentName";

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

test("an agent.list record belongs to its own pane, terminal and harness", () => {
  const pane = { pane_id: "p1", terminal_id: "t1", agent: "claude" };
  const own = { ...pane, name: "rev1" };
  expect(agentListRecord([own], pane)).toBe(own);
  expect(
    agentListRecord([{ pane_id: "p1", name: "rev1" }], pane),
  ).not.toBeNull();
  for (const other of [
    { ...own, pane_id: "p2" },
    { ...own, terminal_id: "t2" },
    { ...own, agent: "codex" },
  ])
    expect(agentListRecord([other], pane)).toBeNull();
});

test("a listed agent pane leads with its name", () => {
  const pane = {
    pane_id: "1a2b3c4d5e",
    terminal_id: "t",
    workspace_id: "w",
    tab_id: "t",
    focused: false,
    agent: "claude",
    agent_name: "rev1",
    agent_status: "idle",
    cwd: "/srv/example/repo",
    revision: 1,
  };
  expect(paneAgentListing(pane).startsWith("rev1 · claude · repo · ")).toBe(
    true,
  );
});
