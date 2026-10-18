import { describe, expect, test } from "bun:test";
import { sendNote, type HerdrCall } from "./board-send";

function herdr(
  options: {
    agent?: boolean;
    terminal?: string;
    blocked?: boolean;
    prompt?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const pane = {
    pane_id: "w1:p1",
    terminal_id: options.terminal ?? "term_example_1",
    agent: options.agent === false ? null : "claude",
  };
  const call: HerdrCall = async (method, params) => {
    calls.push(method);
    if (method === "pane.get") return { pane };
    if (method === "agent.get") return { agent: { ...pane } };
    if (method === "agent.prompt") {
      if (options.blocked) throw new Error("agent_blocked: waiting for input");
      expect(params).toEqual({ target: "w1:p1", text: "Ship the login fix" });
      return options.prompt ?? { agent: { pane_id: "w1:p1" } };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { call, calls };
}
const request = (patch: Partial<Parameters<typeof sendNote>[1]> = {}) => ({
  pane_id: "w1:p1",
  terminal_id: "term_example_1",
  text: "  Ship the login fix ",
  isCurrent: () => true,
  ...patch,
});

describe("Sending a Board note", () => {
  test("sends the trimmed note once to the exact pane", async () => {
    const h = herdr();
    expect(await sendNote(h.call, request())).toEqual({
      status: "sent",
      agent: "claude",
    });
    expect(h.calls.filter((method) => method === "agent.prompt")).toHaveLength(
      1,
    );
  });

  test("refuses when the pane holds a different terminal (Herdr restarted or reused)", async () => {
    const h = herdr({ terminal: "term_after_restart" });
    expect(await sendNote(h.call, request())).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(h.calls).not.toContain("agent.prompt");
  });

  test("refuses a pane without an agent, an empty note and a retired runtime", async () => {
    expect(
      await sendNote(herdr({ agent: false }).call, request()),
    ).toMatchObject({ reason: "no_agent" });
    expect(
      await sendNote(herdr().call, request({ text: "   " })),
    ).toMatchObject({ reason: "empty" });
    const h = herdr();
    expect(
      await sendNote(h.call, request({ isCurrent: () => false })),
    ).toMatchObject({ reason: "stale" });
    expect(h.calls).toEqual([]);
  });

  test("a runtime that retires during the checks sends nothing", async () => {
    const h = herdr();
    let checks = 0;
    const outcome = await sendNote(
      h.call,
      request({ isCurrent: () => ++checks < 2 }),
    );
    expect(outcome).toMatchObject({ status: "refused", reason: "stale" });
    expect(h.calls).not.toContain("agent.prompt");
  });

  test("a blocked agent is refused without sending, and an unconfirmed prompt is reported", async () => {
    expect(
      await sendNote(herdr({ blocked: true }).call, request()),
    ).toMatchObject({ reason: "blocked" });
    expect(await sendNote(herdr({ prompt: {} }).call, request())).toMatchObject(
      { status: "failed" },
    );
  });
});
