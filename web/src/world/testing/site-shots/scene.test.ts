import { describe, expect, test } from "bun:test";
import { townStepLong, townStepOf } from "../../town/townSteps";
import {
  SITE_HOSTS,
  siteConnections,
  siteConversation,
  siteUsage,
} from "./scene";

const NOW = Date.parse("2026-11-09T10:00:00Z");
const agents = SITE_HOSTS.flatMap((host) =>
  host.rooms.flatMap((room) => room.desks.flatMap((desk) => desk.agents)),
);
const panes = siteConnections().flatMap((host) => host.snapshot!.panes);

describe("the website's Town scene", () => {
  test("shows a crew in every state the site describes", () => {
    const states = new Set(agents.map((agent) => agent.state));
    expect([...states].sort()).toEqual(["blocked", "done", "idle", "working"]);
    const summaries = agents.map((agent) => agent.task ?? "");
    expect(summaries.some((task) => task.startsWith("Asks:"))).toBe(true);
    expect(summaries.some((task) => task.startsWith("Blocked:"))).toBe(true);
    expect(new Set(agents.map((agent) => agent.harness))).toEqual(
      new Set(["claude", "codex", "pi"]),
    );
  });

  test("each working agent's conversation gives Town its declared step", () => {
    const working = panes.filter((pane) => pane.agent_status === "working");
    expect(working.length).toBeGreaterThan(5);
    const kinds = new Set<string>();
    for (const pane of working) {
      const step = townStepOf(siteConversation(pane.pane_id, NOW), pane.agent);
      const declared = agents.find((agent) => agent.task === pane.task_summary)!
        .step!;
      expect(step?.kind).toBe(declared.kind);
      expect(step?.task).toBe(declared.task);
      kinds.add(declared.kind);
    }
    // Edit, test, command, read, web and think bubbles all appear.
    expect(kinds.size).toBe(6);
    // The long command is the one amber bubble on screen.
    const long = working.filter((pane) => {
      const step = townStepOf(siteConversation(pane.pane_id, NOW), pane.agent);
      return !!step && townStepLong(step, NOW);
    });
    expect(long.map((pane) => pane.task_summary)).toEqual([
      "Migrate the session table",
    ]);
  });

  test("usage priced for every room, one tired agent and both fuel gauges", () => {
    const usage = siteUsage(NOW);
    expect(usage.today?.total.estimated_cost_usd).toBeGreaterThan(0);
    expect(usage.total.estimated_cost_usd).toBeGreaterThan(
      usage.today!.total.estimated_cost_usd!,
    );
    expect(
      usage.contexts!.filter(
        (context) => context.used_tokens / context.window_tokens! >= 0.85,
      ),
    ).toHaveLength(1);
    expect(usage.limits.map((limit) => limit.harness).sort()).toEqual([
      "claude",
      "codex",
    ]);
    for (const limit of usage.limits)
      for (const window of limit.windows)
        expect(window.resets_at).toBeGreaterThan(NOW);
  });

  test("holds only synthetic names and paths", () => {
    const text = JSON.stringify([siteConnections(), siteUsage(NOW)]);
    expect(text).not.toMatch(/\/home\/|\/Users\/|@|\.local|\.internal/);
    for (const pane of panes) expect(pane.cwd).toMatch(/^\/projects\/[a-z-]+$/);
  });
});
