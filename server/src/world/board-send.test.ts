import { describe, expect, test } from "bun:test";
import { readPaneRecipient } from "./board-recipient";
import { linkedNoteText, sendNote, type HerdrCall } from "./board-send";

/** One agent occupying a pane: its Herdr session (if any) and process group. */
type Occupant = { session?: string; group: number; name?: string };

function herdr(
  options: {
    agent?: boolean;
    terminal?: string;
    blocked?: boolean;
    prompt?: unknown;
    occupant?: Occupant;
    /** The occupant once the prompt has been submitted. */
    afterPrompt?: Occupant;
  } = {},
) {
  const calls: string[] = [];
  let occupant: Occupant = options.occupant ?? {
    session: "session-a",
    group: 4100,
  };
  const pane = {
    pane_id: "w1:p1",
    terminal_id: options.terminal ?? "term_example_1",
    agent: options.agent === false ? null : "claude",
  };
  const call: HerdrCall = async (method, params) => {
    calls.push(method);
    if (method === "pane.get") return { pane };
    if (method === "agent.get")
      return {
        agent: {
          ...pane,
          ...(occupant.name ? { name: occupant.name } : {}),
          ...(occupant.session
            ? {
                agent_session: {
                  source: "hook",
                  agent: "claude",
                  kind: "id",
                  value: occupant.session,
                },
              }
            : {}),
        },
      };
    if (method === "pane.process_info")
      return {
        process_info: {
          pane_id: "w1:p1",
          foreground_process_group_id: occupant.group,
        },
      };
    if (method === "agent.prompt") {
      if (options.blocked) throw new Error("agent_blocked: waiting for input");
      expect(params).toEqual({ target: "w1:p1", text: "Ship the login fix" });
      if (options.afterPrompt) occupant = options.afterPrompt;
      return options.prompt ?? { agent: { pane_id: "w1:p1" } };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { call, calls };
}
/** The recipient token the service records for an occupant. */
async function tokenOf(
  occupant: Occupant = { session: "session-a", group: 4100 },
) {
  const read = await readPaneRecipient(herdr({ occupant }).call, "w1:p1");
  if ("none" in read) throw new Error("no recipient");
  return read.token;
}
const AGENT_A = { session: "session-a", group: 4100 };
const AGENT_B = { session: "session-b", group: 5200, name: "reviewer" };
const request = async (
  patch: Partial<Parameters<typeof sendNote>[1]> = {},
) => ({
  pane_id: "w1:p1",
  terminal_id: "term_example_1",
  text: "  Ship the login fix ",
  recipient: await tokenOf(AGENT_A),
  isCurrent: () => true,
  ...patch,
});
const prompts = (calls: string[]) =>
  calls.filter((method) => method === "agent.prompt").length;

describe("Sending a Board note", () => {
  test("sends the trimmed note once to the exact pane", async () => {
    const h = herdr();
    expect(await sendNote(h.call, await request())).toEqual({
      status: "sent",
      agent: "claude",
    });
    expect(h.calls.filter((method) => method === "agent.prompt")).toHaveLength(
      1,
    );
  });

  test("refuses when the pane holds a different terminal (Herdr restarted or reused)", async () => {
    const h = herdr({ terminal: "term_after_restart" });
    expect(await sendNote(h.call, await request())).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(h.calls).not.toContain("agent.prompt");
  });

  test("refuses a pane without an agent, an empty note and a retired runtime", async () => {
    expect(
      await sendNote(herdr({ agent: false }).call, await request()),
    ).toMatchObject({ reason: "no_agent" });
    expect(
      await sendNote(herdr().call, await request({ text: "   " })),
    ).toMatchObject({ reason: "empty" });
    const h = herdr();
    expect(
      await sendNote(h.call, await request({ isCurrent: () => false })),
    ).toMatchObject({ reason: "stale" });
    expect(h.calls).toEqual([]);
  });

  test("a runtime that retires during the checks sends nothing", async () => {
    const h = herdr();
    let checks = 0;
    const outcome = await sendNote(
      h.call,
      await request({ isCurrent: () => ++checks < 2 }),
    );
    expect(outcome).toMatchObject({ status: "refused", reason: "stale" });
    expect(h.calls).not.toContain("agent.prompt");
  });

  test("a blocked agent is refused without sending, and an unconfirmed prompt is reported", async () => {
    expect(
      await sendNote(herdr({ blocked: true }).call, await request()),
    ).toMatchObject({ reason: "blocked" });
    expect(
      await sendNote(herdr({ prompt: {} }).call, await request()),
    ).toMatchObject({ status: "failed" });
  });
});

describe("Send goes only to the agent the note was strung to (#228)", () => {
  test("a replacement agent in the same pane and terminal is refused, naming it", async () => {
    const h = herdr({ occupant: AGENT_B });
    const outcome = await sendNote(h.call, await request());
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "replaced",
      agent: "reviewer",
      recipient: await tokenOf(AGENT_B),
    });
    expect(prompts(h.calls)).toBe(0);
  });

  test("confirming the replacement sends to it and records it on the string", async () => {
    const h = herdr({ occupant: AGENT_B });
    const outcome = await sendNote(
      h.call,
      await request({ confirm_recipient: await tokenOf(AGENT_B) }),
    );
    expect(outcome).toEqual({
      status: "sent",
      agent: "reviewer",
      recipient: await tokenOf(AGENT_B),
    });
    expect(prompts(h.calls)).toBe(1);
  });

  test("a confirmation for an agent that has since been replaced again is refused", async () => {
    const h = herdr({ occupant: { session: "session-c", group: 6300 } });
    const outcome = await sendNote(
      h.call,
      await request({ confirm_recipient: await tokenOf(AGENT_B) }),
    );
    expect(outcome).toMatchObject({ status: "refused", reason: "replaced" });
    expect(prompts(h.calls)).toBe(0);
  });

  test("a string whose agent Board never recorded asks first", async () => {
    const h = herdr();
    const outcome = await sendNote(
      h.call,
      await request({ recipient: undefined }),
    );
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "unbound",
      agent: "claude",
    });
    expect(prompts(h.calls)).toBe(0);
    expect(
      await sendNote(
        herdr().call,
        await request({
          recipient: undefined,
          confirm_recipient: await tokenOf(AGENT_A),
        }),
      ),
    ).toMatchObject({ status: "sent", recipient: await tokenOf(AGENT_A) });
  });

  test("a replacement during the prompt is reported, never as sent", async () => {
    const h = herdr({ afterPrompt: AGENT_B });
    const outcome = await sendNote(h.call, await request());
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" && outcome.message).toContain(
      "changed while the note was being sent",
    );
    expect(prompts(h.calls)).toBe(1);
  });

  test("without a session the agent's process group identifies it", async () => {
    const before = { group: 4100 };
    const recipient = await tokenOf(before);
    // The same agent, reporting a session only after its first prompt.
    const same = herdr({
      occupant: before,
      afterPrompt: { session: "session-a", group: 4100 },
    });
    expect(
      await sendNote(same.call, await request({ recipient })),
    ).toMatchObject({
      status: "sent",
      recipient: await tokenOf({ session: "session-a", group: 4100 }),
    });
    // A new agent in the same shell has a new process group.
    const replaced = herdr({ occupant: { group: 5200 } });
    expect(
      await sendNote(replaced.call, await request({ recipient })),
    ).toMatchObject({ status: "refused", reason: "replaced" });
    expect(prompts(replaced.calls)).toBe(0);
  });

  test("an agent Board cannot identify is refused", async () => {
    const h = herdr();
    const call: HerdrCall = async (method, params) =>
      method === "pane.process_info"
        ? { process_info: { pane_id: "w1:p1" } }
        : method === "agent.get"
          ? { agent: { pane_id: "w1:p1", terminal_id: "term_example_1" } }
          : h.call(method, params);
    expect(await sendNote(call, await request())).toMatchObject({
      status: "refused",
      reason: "changed",
    });
  });
});

describe("the saved link a Send relies on", () => {
  const doc = (
    patch: { rev?: number; detached?: boolean; witness?: string[] } = {},
  ) => ({
    version: 1 as const,
    revision: 3,
    layout: {
      anchors: {},
      offsets: {},
      pinned: {},
      folded: [],
      colors: {},
      desk_pins: {},
      interest: {},
    },
    notes: [
      {
        id: "n1",
        text: "Ship it",
        color: "yellow" as const,
        x: 0,
        y: 0,
        rev: patch.rev ?? 2,
      },
    ],
    strings: [
      {
        id: "s1",
        from: { note: "n1" },
        to: {
          anchor: {
            connection_id: "studio",
            kind: "pane" as const,
            native_id: "w1:p1",
            witness: patch.witness ?? ["term_1"],
          },
        },
        ...(patch.detached ? { detached: true } : {}),
      },
    ],
  });
  const link = {
    connection_id: "studio",
    pane_id: "w1:p1",
    terminal_id: "term_1",
    note_id: "n1",
    string_id: "s1",
    note_rev: 2,
  };
  test("an intact link yields the saved text", () => {
    expect(linkedNoteText(doc(), link)).toEqual({ text: "Ship it", end: "to" });
    const bound = doc();
    (bound.strings[0]!.to.anchor as { recipient?: string }).recipient = "r1";
    expect(linkedNoteText(bound, link)).toMatchObject({ recipient: "r1" });
  });
  test("an edited, deleted or unstrung note, or another pane, is refused", () => {
    expect(linkedNoteText(doc({ rev: 3 }), link)).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(linkedNoteText({ ...doc(), notes: [] }, link)).toMatchObject({
      status: "refused",
    });
    expect(linkedNoteText({ ...doc(), strings: [] }, link)).toMatchObject({
      status: "refused",
    });
    expect(linkedNoteText(doc({ detached: true }), link)).toMatchObject({
      status: "refused",
    });
    expect(linkedNoteText(doc(), { ...link, pane_id: "w1:p2" })).toMatchObject({
      status: "refused",
    });
    expect(
      linkedNoteText(doc(), { ...link, connection_id: "other" }),
    ).toMatchObject({ status: "refused" });
    expect(linkedNoteText(doc({ witness: ["term_9"] }), link)).toMatchObject({
      status: "refused",
    });
  });
});
