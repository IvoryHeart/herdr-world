import * as layoutPreferences from "../layoutPreferences";
import { describe, expect, spyOn, test } from "bun:test";
import {
  downloadSession,
  downloadSessionAtif,
  exportSessionForConnection,
  agentStateKind,
  firstLinePreview,
  formatTokenTotal,
  type AgentSessionSummary,
  groupAgentPanesByWorkspace,
  groupTrajectoryTurns,
  type AgentSessionTrajectoryStep,
  paneHasAgentHistory,
  shouldShowAgentStatusLabel,
  summarizeTabAgents,
  toolArgumentsPreview,
} from "./agentSession";
import { __storeTesting, store } from "../store";
import type { ConnectionClient } from "../api";

test.each(["raw", "atif", "export"])(
  "%s session download reports a share-platform HTTP failure without reopening it",
  async (format) => {
    const descriptors = ["window", "navigator"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    );
    const previousFetch = globalThis.fetch;
    const mobile = spyOn(layoutPreferences, "isMobileLayout").mockReturnValue(
      true,
    );
    const previousState = store.get();
    let opened = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "https://world.example.test", search: "" },
        matchMedia: () => ({ matches: false }),
        open: () => {
          opened++;
        },
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "iPhone",
        maxTouchPoints: 5,
        canShare: () => true,
        share: async () => {
          opened++;
        },
      },
    });
    globalThis.fetch = (async () =>
      Response.json(
        { error: "Synthetic session changed" },
        {
          status: 409,
          headers: {
            "X-Herdr-Connection-Id": "beta",
            "X-Herdr-Connection-Generation": "7",
          },
        },
      )) as unknown as typeof fetch;
    const client: ConnectionClient = {
      connectionId: "beta",
      generation: 1,
      serverRuntimeGeneration: 7,
      isCurrent: () => true,
      acceptsServerGeneration: () => true,
      call: async () => ({
        status: "ok",
        session: { value: "synthetic-session" },
      }),
    };
    const source = {
      pane_id: "same-pane",
      agent: "pi",
    } as import("../types").Pane;
    try {
      store.clearNotice();
      if (format === "raw")
        await downloadSession(source, client, "synthetic-session");
      else if (format === "atif")
        await downloadSessionAtif(
          source,
          "synthetic.jsonl",
          client,
          "synthetic-session",
        );
      else await exportSessionForConnection(source, client);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.get().notice).toMatchObject({
        kind: "error",
        message: "Session download failed",
      });
      expect(store.get().notice?.detail).toContain("409");
      expect(opened).toBe(0);
    } finally {
      mobile.mockRestore();
      globalThis.fetch = previousFetch;
      __storeTesting.replaceState(previousState);
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  },
);

test("raw export URL retains the displayed original session", () => {
  const originals = ["window", "navigator"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let url = "";
  const link = {
    href: "",
    click() {
      url = this.href;
    },
    remove() {},
    download: "",
    rel: "",
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "http://localhost" },
      matchMedia: () => ({ matches: false }),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Chrome", maxTouchPoints: 0 },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => link, body: { appendChild() {} } },
  });
  try {
    downloadSession(
      { pane_id: "same-pane", agent: "pi" } as import("../types").Pane,
      {
        connectionId: "beta",
        serverRuntimeGeneration: 7,
        isCurrent: () => true,
      } as import("../api").ConnectionClient,
      "original-session",
    );
    expect(new URL(url).searchParams.get("expected_session")).toBe(
      "original-session",
    );
    expect(new URL(url).pathname).toContain("/beta/");
    expect(new URL(url).searchParams.get("connection_generation")).toBe("7");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

function step(
  stepId: number,
  source: AgentSessionTrajectoryStep["source"],
  message: string,
): AgentSessionTrajectoryStep {
  return {
    step_id: stepId,
    source,
    message,
  };
}

describe("agent session presentation", () => {
  test("does not invent totals when the server explicitly reports unknown accounting", () => {
    const summary: AgentSessionSummary = {
      status: "ok",
      agent: "muse",
      pane_id: "p1",
      path: "/session.jsonl",
      updated_at: "2026-09-01T00:00:00Z",
      file: null,
      stats: {
        turns: 1,
        records: 1,
        token_usage: {
          input_tokens: 20,
          cached_input_tokens: 4,
          output_tokens: 5,
          total_tokens: null,
        },
      },
    };
    expect(formatTokenTotal(summary)).toBe("-");
    summary.stats.token_usage!.total_tokens = 25;
    expect(formatTokenTotal(summary)).toBe("25");
    summary.stats.token_usage!.total_tokens = 0;
    expect(formatTokenTotal(summary)).toBe("0");
    delete summary.stats.token_usage!.total_tokens;
    expect(formatTokenTotal(summary)).toBe("29");
  });
  test("keeps history available when an agent pane has unknown status", () => {
    expect(
      paneHasAgentHistory({ agent: "codex", agent_status: "unknown" }),
    ).toBe(true);
    expect(paneHasAgentHistory({ agent: "   " })).toBe(false);
    expect(paneHasAgentHistory(null)).toBe(false);
  });

  test("groups agent panes beneath their owning workspace", () => {
    const grouped = groupAgentPanesByWorkspace([
      { agent: "pi", workspace_id: "w1", pane_id: "p1" },
      { agent: undefined, workspace_id: "w1", pane_id: "p2" },
      { agent: "codex", workspace_id: "w2", pane_id: "p3" },
      { agent: "claude", workspace_id: "w1", pane_id: "p4" },
    ]);

    expect(grouped.get("w1")?.map((pane) => pane.pane_id)).toEqual([
      "p1",
      "p4",
    ]);
    expect(grouped.get("w2")?.map((pane) => pane.pane_id)).toEqual(["p3"]);
    expect(grouped.size).toBe(2);
  });

  test("summarizes the focused tab agent and its work state", () => {
    const panes = [
      {
        agent: "pi",
        agent_status: "working",
        focused: false,
        tab_id: "t1",
      },
      {
        agent: "codex",
        agent_status: "idle",
        focused: true,
        tab_id: "t1",
      },
      {
        agent: "PI",
        agent_status: "blocked",
        focused: false,
        tab_id: "t1",
      },
    ];

    expect(summarizeTabAgents(panes, "t1")).toEqual({
      primaryAgent: "codex",
      additionalAgents: 1,
      agents: ["codex", "pi"],
      status: "idle",
    });
    expect(
      summarizeTabAgents(
        panes.map((pane) => ({ ...pane, focused: false })),
        "t1",
      ),
    ).toMatchObject({ primaryAgent: "pi", status: "blocked" });
    expect(summarizeTabAgents(panes, "missing")).toBeNull();
    expect(agentStateKind("WORKING")).toBe("working");
    expect(agentStateKind("stopped")).toBe("unknown");
    expect(shouldShowAgentStatusLabel("idle")).toBe(false);
    expect(shouldShowAgentStatusLabel("unknown")).toBe(false);
    expect(shouldShowAgentStatusLabel("working")).toBe(true);
    expect(shouldShowAgentStatusLabel("blocked")).toBe(true);
    expect(shouldShowAgentStatusLabel("done")).toBe(true);
  });

  test("groups setup records and subsequent activity into user turns", () => {
    const groups = groupTrajectoryTurns([
      step(1, "system", "session start"),
      step(2, "user", "first request"),
      step(3, "agent", "first response"),
      step(4, "system", "tool result"),
      step(5, "user", "second request"),
      step(6, "agent", "second response"),
    ]);

    expect(groups.map((group) => group.number)).toEqual([null, 1, 2]);
    expect(
      groups.map((group) => group.steps.map((item) => item.step_id)),
    ).toEqual([[1], [2, 3, 4], [5, 6]]);
  });

  test("keeps agent-only trajectories in a setup group", () => {
    const groups = groupTrajectoryTurns([
      step(1, "agent", "restored response"),
      step(2, "system", "usage"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].number).toBeNull();
    expect(groups[0].steps).toHaveLength(2);
  });

  test("previews tool call arguments by priority key", () => {
    expect(
      toolArgumentsPreview({ command: "ls\napps/roadie", cwd: "/repo" }),
    ).toBe("ls apps/roadie");
    expect(toolArgumentsPreview({ file_path: "src/index.ts" })).toBe(
      "src/index.ts",
    );
    expect(toolArgumentsPreview({}, "List files in apps/roadie")).toBe(
      "List files in apps/roadie",
    );
    expect(toolArgumentsPreview({ a: 1 })).toBe('{"a":1}');
    expect(
      toolArgumentsPreview({ command: "x".repeat(120) }, undefined, 10),
    ).toBe(`${"x".repeat(10)}…`);
  });

  test("previews the first non-empty line with truncation", () => {
    expect(firstLinePreview("\n  first line  \nsecond")).toBe("first line");
    expect(firstLinePreview("")).toBe("");
    expect(firstLinePreview("x".repeat(120), 10)).toBe(`${"x".repeat(10)}…`);
  });
});
