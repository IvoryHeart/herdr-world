import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interestKey } from "../../../shared/interest";
import { BoardStore } from "./board-store";
import { closesTerminals, pruneGoneInterest } from "./interest-prune";

let root: string;
let path: string;
beforeEach(() => {
  root = join(tmpdir(), `interest-${crypto.randomUUID()}`);
  mkdirSync(join(root, "boards"), { recursive: true });
  path = join(root, "boards", "board.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const muted = interestKey("conn-a", "term_1");
const focused = interestKey("conn-a", "term_2");
const elsewhere = interestKey("conn-b", "term_1");

function seeded() {
  const store = new BoardStore(path);
  store.patch([
    { op: "interest.set", key: muted, interest: "muted" },
    { op: "interest.set", key: focused, interest: "focused" },
    { op: "interest.set", key: elsewhere, interest: "muted" },
  ]);
  return store;
}

const host = (
  listing: unknown,
  options: { current?: () => boolean; fail?: boolean } = {},
) => {
  const revisions: number[] = [];
  return {
    revisions,
    call: async () => {
      if (options.fail) throw new Error("host unreachable");
      return listing;
    },
    isCurrent: options.current ?? (() => true),
    changed: (revision: number) => revisions.push(revision),
  };
};

describe("agent interest", () => {
  test("is set, cleared to watching and persisted per terminal", () => {
    const store = seeded();
    store.patch([{ op: "interest.set", key: focused, interest: null }]);
    expect(new BoardStore(path).get().layout.interest).toEqual({
      [muted]: "muted",
      [elsewhere]: "muted",
    });
    expect(() =>
      store.patch([
        { op: "interest.set", key: muted, interest: "loud" as "muted" },
      ]),
    ).toThrow("interest");
  });

  test("a board saved before interest loads with every agent watched", () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        revision: 3,
        layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
        notes: [],
        strings: [],
      }),
    );
    expect(new BoardStore(path).get().layout.interest).toEqual({});
  });

  test("a fresh listing from the live host drops only that host's gone terminals", async () => {
    const store = seeded();
    const live = host({ panes: [{ pane_id: "w1:p2", terminal_id: "term_2" }] });
    await pruneGoneInterest(store, "conn-a", live);
    expect(store.get().layout.interest).toEqual({
      [focused]: "focused",
      [elsewhere]: "muted",
    });
    expect(live.revisions).toEqual([store.get().revision]);
    expect(JSON.parse(readFileSync(path, "utf8")).layout.interest).toEqual(
      store.get().layout.interest,
    );
  });

  test("a failed, stale or incomplete listing keeps every record", async () => {
    const store = seeded();
    const before = store.get();
    const gone = { panes: [] };
    for (const attempt of [
      host(gone, { fail: true }),
      host(gone, { current: () => false }),
      host({ panes: [{ pane_id: "w1:p2" }] }),
      host({ error: "unsupported" }),
    ]) {
      await pruneGoneInterest(store, "conn-a", attempt);
      expect(attempt.revisions).toEqual([]);
    }
    expect(store.get()).toEqual(before);
  });

  test("a host with no records is not asked", async () => {
    const store = new BoardStore(path);
    let asked = false;
    await pruneGoneInterest(store, "conn-a", {
      ...host({ panes: [] }),
      call: async () => {
        asked = true;
        return { panes: [] };
      },
    });
    expect(asked).toBe(false);
  });

  test("closing a pane, tab or workspace triggers a check; other events do not", () => {
    expect(closesTerminals("pane_closed")).toBe(true);
    expect(closesTerminals("tab.closed")).toBe(true);
    expect(closesTerminals("workspace_closed")).toBe(true);
    expect(closesTerminals("pane_agent_status_changed")).toBe(false);
    expect(closesTerminals(null)).toBe(false);
  });
});
