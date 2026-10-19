import { describe, expect, test } from "bun:test";
import {
  decodeRecipient,
  encodeRecipient,
  recipientOps,
  sameRecipient,
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
  const found = {
    token: token("claude", "s1", 10),
    label: "claude",
    terminal_id: "term_1",
  };

  test("a new pane string records the agent its host reports", async () => {
    const asked: string[] = [];
    const ops = await recipientOps(
      doc(pane("w1:p1")),
      [put(pane("w1:p1"))],
      async (c, p) => {
        asked.push(`${c}/${p}`);
        return found;
      },
    );
    expect(asked).toEqual(["studio/w1:p1"]);
    expect(ops).toEqual([
      {
        op: "anchor.recipient",
        string_id: "s1",
        end: "to",
        pane_id: "w1:p1",
        terminal_id: "term_1",
        recipient: found.token,
      },
    ]);
  });

  test("a re-witnessed pane is read again", async () => {
    const ops = await recipientOps(
      doc(pane("w1:p1")),
      [
        {
          op: "anchor.witness",
          string_id: "s1",
          end: "to",
          witness: ["term_1"],
        },
      ],
      async () => found,
    );
    expect(ops).toHaveLength(1);
  });

  test("no record without an agent, a ready host or a witnessed terminal", async () => {
    const d = doc(pane("w1:p1"));
    const ops = [put(pane("w1:p1"))];
    expect(
      await recipientOps(d, ops, async () => ({ none: "no_agent" })),
    ).toEqual([]);
    expect(await recipientOps(d, ops, async () => null)).toEqual([]);
    expect(
      await recipientOps(d, ops, async () => {
        throw new Error("connection is not ready");
      }),
    ).toEqual([]);
    expect(
      await recipientOps(d, ops, async () => ({
        ...found,
        terminal_id: "term_9",
      })),
    ).toEqual([]);
  });

  test("tab and workspace strings, and strings since removed, are left alone", async () => {
    const tab: BoardAnchor = { ...pane("w1:t1"), kind: "tab" };
    const read = async () => found;
    expect(await recipientOps(doc(tab), [put(tab)], read)).toEqual([]);
    expect(
      await recipientOps(
        { ...doc(pane("w1:p1")), strings: [] },
        [put(pane("w1:p1"))],
        read,
      ),
    ).toEqual([]);
  });
});
