import { describe, expect, test } from "bun:test";
import { startFromNote, type HerdrCall } from "./board-start";

/** A fake Herdr whose agent becomes interactive after `readyAfter` checks. */
function herdr(
  options: {
    readyAfter?: number;
    never?: boolean;
    blocked?: boolean;
    lostStart?: boolean;
    changes?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let checks = 0;
  const call: HerdrCall = async (method, params) => {
    calls.push(method);
    if (method === "tab.create")
      return {
        tab: { tab_id: "w1:t9" },
        root_pane: { pane_id: "w1:p9", terminal_id: "term_new" },
      };
    if (method === "agent.start") {
      if (options.lostStart) throw new Error("timed out");
      return { agent: { pane_id: "w1:p9" } };
    }
    if (method === "pane.get")
      return {
        pane: {
          pane_id: "w1:p9",
          terminal_id:
            options.changes && checks > 0 ? "term_other" : "term_new",
        },
      };
    if (method === "agent.get") {
      checks += 1;
      if (checks <= (options.readyAfter ?? 1))
        throw new Error("agent_not_found: no agent yet");
      return {
        agent: {
          pane_id: "w1:p9",
          agent_status: options.blocked ? "blocked" : "idle",
          interactive_ready: !options.never,
        },
      };
    }
    if (method === "agent.prompt") {
      expect(params).toEqual({ target: "w1:p9", text: "Plan the migration" });
      return { agent: { pane_id: "w1:p9" } };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { call, calls };
}
function request(patch: Partial<Parameters<typeof startFromNote>[1]> = {}) {
  let clock = 0;
  return {
    workspace_id: "w1",
    kind: "claude",
    name: "plan",
    text: " Plan the migration ",
    isCurrent: () => true,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    timeoutMs: 5_000,
    ...patch,
  };
}

describe("Starting an agent from a note", () => {
  test("creates a tab, starts the agent, waits until it is ready and prompts it once", async () => {
    const h = herdr({ readyAfter: 3 });
    expect(await startFromNote(h.call, request())).toEqual({
      status: "sent",
      tab_id: "w1:t9",
      pane_id: "w1:p9",
      terminal_id: "term_new",
    });
    expect(h.calls.filter((m) => m === "agent.start")).toHaveLength(1);
    expect(h.calls.filter((m) => m === "agent.prompt")).toHaveLength(1);
  });

  test("an agent that never becomes ready is uncertain, with nothing sent", async () => {
    const h = herdr({ never: true });
    const outcome = await startFromNote(h.call, request());
    expect(outcome).toMatchObject({
      status: "uncertain",
      pane_id: "w1:p9",
      message: expect.stringContaining("may still be starting"),
    });
    expect(h.calls).not.toContain("agent.prompt");
  });

  test("a lost start reply is inspected, never relaunched", async () => {
    const h = herdr({ lostStart: true });
    expect(await startFromNote(h.call, request())).toMatchObject({
      status: "sent",
    });
    expect(h.calls.filter((m) => m === "agent.start")).toHaveLength(1);
  });

  test("a blocked agent, a changed tab or a retired runtime sends nothing and reports what was created", async () => {
    for (const options of [{ blocked: true }, { changes: true }]) {
      const h = herdr({ readyAfter: 1, ...options });
      const outcome = await startFromNote(h.call, request());
      expect(outcome.status).not.toBe("sent");
      expect(outcome).toMatchObject({ tab_id: "w1:t9" });
      expect(h.calls).not.toContain("agent.prompt");
    }
    let checks = 0;
    const h = herdr();
    const outcome = await startFromNote(
      h.call,
      request({ isCurrent: () => ++checks < 3 }),
    );
    expect(outcome).toMatchObject({
      status: "uncertain",
      message: expect.stringContaining("reconnected"),
    });
    expect(h.calls).not.toContain("agent.prompt");
  });

  test("an unknown kind does nothing", async () => {
    const h = herdr();
    expect(
      await startFromNote(h.call, request({ kind: "rm -rf" })),
    ).toMatchObject({ status: "failed" });
    expect(h.calls).toEqual([]);
  });

  test("with no text the agent is started and nothing is sent", async () => {
    const h = herdr();
    expect(await startFromNote(h.call, request({ text: "  " }))).toEqual({
      status: "started",
      tab_id: "w1:t9",
      pane_id: "w1:p9",
      terminal_id: "term_new",
    });
    expect(h.calls).toEqual(["tab.create", "agent.start"]);
    const lost = herdr({ lostStart: true });
    expect(await startFromNote(lost.call, request({ text: "" }))).toMatchObject(
      { status: "uncertain", pane_id: "w1:p9" },
    );
    expect(lost.calls.filter((m) => m === "agent.start")).toHaveLength(1);
  });
});
