import { describe, expect, test } from "bun:test";
import {
  decodeRecipient,
  encodeRecipient,
  recipientOps,
  sameRecipient,
  sessionOf,
} from "./board-recipient";
import type { BoardAnchor, BoardDocument, BoardOp } from "./board-store";

const token = (agent: string, session?: string, group?: number) =>
  encodeRecipient({ agent, session, group });

describe("Which agent a Board string is for", () => {
  test("the same session, or the same process group when either lacks one", () => {
    expect(
      sameRecipient(token("claude", "s1", 10), token("claude", "s1", 11)),
    ).toBe(true);
    expect(
      sameRecipient(token("claude", undefined, 10), token("claude", "s1", 10)),
    ).toBe(true);
    expect(
      sameRecipient(token("claude", "s1", 10), token("claude", "s2", 10)),
    ).toBe(false);
    expect(
      sameRecipient(
        token("claude", undefined, 10),
        token("claude", undefined, 11),
      ),
    ).toBe(false);
    expect(
      sameRecipient(token("claude", "s1", 10), token("codex", "s1", 10)),
    ).toBe(false);
  });

  test("nothing, a malformed token or one with no identity matches nothing", () => {
    expect(sameRecipient(undefined, token("claude", "s1", 10))).toBe(false);
    expect(sameRecipient("not json", "not json")).toBe(false);
    expect(decodeRecipient(token("claude"))).toBeNull();
    expect(decodeRecipient(JSON.stringify(["claude", 7, null]))).toBeNull();
    expect(decodeRecipient("x".repeat(300))).toBeNull();
  });
});

describe("Recording a string's agent", () => {
  const pane = (native_id: string, witness = ["term_1"]): BoardAnchor => ({
    connection_id: "studio",
    kind: "pane",
    native_id,
    witness,
  });
  const doc = (to: BoardAnchor): BoardDocument => ({
    version: 1,
    revision: 1,
    layout: { anchors: {}, offsets: {}, pinned: {}, folded: [], colors: {} },
    notes: [],
    strings: [{ id: "s1", from: { note: "n1" }, to: { anchor: to } }],
  });
  const put = (to: BoardAnchor): BoardOp => ({
    op: "string.put",
    string: { id: "s1", from: { note: "n1" }, to: { anchor: to } },
  });
  const sessionA = { source: "hook", kind: "id", value: "session-a" };
  const sessionB = { source: "hook", kind: "id", value: "session-b" };
  /** What the browser showed when the user strung the note. */
  const saw = (session?: typeof sessionA) =>
    new Map([["s1:to", { agent: "claude", ...(session ? { session } : {}) }]]);
  const agentWith = (session: typeof sessionA, group = 10) => ({
    token: token("claude", sessionOf(session), group),
    label: "claude",
    terminal_id: "term_1",
  });

  test("the agent the browser showed is recorded, qualified by host, pane and terminal", async () => {
    const asked: string[] = [];
    const ops = await recipientOps(
      doc(pane("w1:p1")),
      [put(pane("w1:p1"))],
      saw(sessionA),
      async (c, p) => {
        asked.push(`${c}/${p}`);
        return agentWith(sessionA);
      },
    );
    expect(asked).toEqual(["studio/w1:p1"]);
    expect(ops).toEqual([
      {
        op: "anchor.recipient",
        string_id: "s1",
        end: "to",
        connection_id: "studio",
        pane_id: "w1:p1",
        terminal_id: "term_1",
        recipient: agentWith(sessionA).token,
      },
    ]);
  });

  test("a replacement before the read leaves the string unbound (review P1)", async () => {
    // A exits and B starts in the same pane and terminal after the save.
    expect(
      await recipientOps(
        doc(pane("w1:p1")),
        [put(pane("w1:p1"))],
        saw(sessionA),
        async () => agentWith(sessionB, 20),
      ),
    ).toEqual([]);
  });

  test("without a session the browser saw, nothing is read or recorded", async () => {
    let asked = 0;
    const read = async () => {
      asked++;
      return agentWith(sessionA);
    };
    const d = doc(pane("w1:p1"));
    const ops = [put(pane("w1:p1"))];
    expect(await recipientOps(d, ops, saw(), read)).toEqual([]);
    expect(await recipientOps(d, ops, new Map(), read)).toEqual([]);
    expect(asked).toBe(0);
    // Re-witnessing after a Herdr restart is never bound from a guess.
    expect(
      await recipientOps(
        d,
        [
          {
            op: "anchor.witness",
            string_id: "s1",
            end: "to",
            witness: ["term_1"],
          },
        ],
        saw(sessionA),
        read,
      ),
    ).toEqual([]);
  });

  test("no record without an agent, a ready host or a witnessed terminal", async () => {
    const d = doc(pane("w1:p1"));
    const ops = [put(pane("w1:p1"))];
    const seen = saw(sessionA);
    expect(
      await recipientOps(d, ops, seen, async () => ({ none: "no_agent" })),
    ).toEqual([]);
    expect(await recipientOps(d, ops, seen, async () => null)).toEqual([]);
    expect(
      await recipientOps(d, ops, seen, async () => {
        throw new Error("connection is not ready");
      }),
    ).toEqual([]);
    expect(
      await recipientOps(d, ops, seen, async () => ({
        ...agentWith(sessionA),
        terminal_id: "term_9",
      })),
    ).toEqual([]);
  });

  test("tab and workspace strings, and strings since removed, are left alone", async () => {
    const tab: BoardAnchor = { ...pane("w1:t1"), kind: "tab" };
    const read = async () => agentWith(sessionA);
    expect(
      await recipientOps(doc(tab), [put(tab)], saw(sessionA), read),
    ).toEqual([]);
    expect(
      await recipientOps(
        { ...doc(pane("w1:p1")), strings: [] },
        [put(pane("w1:p1"))],
        saw(sessionA),
        read,
      ),
    ).toEqual([]);
  });
});
