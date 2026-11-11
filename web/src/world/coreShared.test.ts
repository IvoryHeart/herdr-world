import { describe, expect, test } from "bun:test";
import { type CoreShared, CoreSeenSharer, coreSharedOf } from "./coreShared";
import type { Pane } from "../types";

const agent = (fields: Partial<CoreShared> = {}): CoreShared => ({
  connectionId: "box-core",
  generation: 2,
  terminal: "t1",
  turn: 3,
  seen: 2,
  favourite: false,
  ...fields,
});

function sharer(fail = false) {
  const sent: CoreShared[] = [];
  const s = new CoreSeenSharer(async (target) => {
    sent.push(target);
    if (fail) throw new Error("core away");
  });
  return { s, sent };
}

describe("World shares each looked-at turn once (Herdr's labels contract)", () => {
  test("a hidden or unfocused page never clears done", () => {
    const { s, sent } = sharer();
    expect(s.update([agent()], false)).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("looking shares the turn once, however often the view updates", () => {
    const { s } = sharer();
    expect(s.update([agent()], true)).toEqual([agent()]);
    expect(s.update([agent()], true)).toEqual([]);
    expect(s.update([agent({ generation: 3 })], true)).toEqual([]);
  });

  test("another client's mark unread survives a screen left on", () => {
    const { s } = sharer();
    s.update([agent()], true);
    // The phone marks turn 3 unread (seen = 2); World still shows the agent.
    expect(s.update([agent({ seen: 2 })], true)).toEqual([]);
    // Looking again later raises it again.
    s.update([], true);
    expect(s.update([agent({ seen: 2 })], true)).toHaveLength(1);
  });

  test("a new turn while looking is shared once", () => {
    const { s } = sharer();
    s.update([agent()], true);
    expect(s.update([agent({ turn: 4, seen: 3 })], true)).toEqual([
      agent({ turn: 4, seen: 3 }),
    ]);
    expect(s.update([agent({ turn: 4, seen: 3 })], true)).toEqual([]);
  });

  test("going to the background ends the look", () => {
    const { s } = sharer();
    s.update([agent()], true);
    s.update([agent()], false);
    expect(s.update([agent({ seen: 2 })], true)).toHaveLength(1);
  });

  test("a host flicker is not a new look", () => {
    const { s } = sharer();
    s.update([agent()], true);
    expect(s.update([agent({ stale: true, seen: 2 })], true)).toEqual([]);
    expect(s.update([agent({ seen: 2 })], true)).toEqual([]);
    // A turn that ended while stale is shared once the host is back.
    expect(s.update([agent({ stale: true, turn: 4 })], true)).toEqual([]);
    expect(s.update([agent({ turn: 4 })], true)).toHaveLength(1);
  });

  test("already seen, or without a turn: nothing to write", () => {
    const { s } = sharer();
    expect(s.update([agent({ seen: 3 })], true)).toEqual([]);
    expect(s.update([agent({ seen: 9 })], true)).toEqual([]);
    expect(s.update([agent({ terminal: "t2", turn: -1 })], true)).toEqual([]);
  });

  test("a missing seen label is not 0: turn 0 joins", () => {
    const { s } = sharer();
    expect(s.update([agent({ turn: 0, seen: null })], true)).toHaveLength(1);
  });

  test("two agents on screen are independent", () => {
    const { s } = sharer();
    const other = agent({ terminal: "t2" });
    expect(s.update([agent(), other], true)).toHaveLength(2);
    expect(s.update([agent({ turn: 4 }), other], true)).toEqual([
      agent({ turn: 4 }),
    ]);
  });

  test("a failed write is not retried; the next look or turn shares it", async () => {
    const { s, sent } = sharer(true);
    s.update([agent()], true);
    await Bun.sleep(0);
    s.update([agent()], true);
    expect(sent).toHaveLength(1);
    // A new turn while looking, or a new look, tries again.
    s.update([agent({ turn: 4 })], true);
    s.update([], true);
    s.update([agent({ turn: 4 })], true);
    expect(sent.map((target) => target.turn)).toEqual([3, 4, 4]);
  });

  test("a look that spans a reconnect shares its turn once the host is back", () => {
    const { s, sent } = sharer();
    s.update([agent({ stale: true })], true);
    expect(sent).toHaveLength(0);
    s.update([agent({ generation: 3 })], true);
    expect(sent).toHaveLength(1);
  });
});

describe("only herdr-core panes are shared", () => {
  const pane = (fields: Partial<Pane>): Pane =>
    ({
      pane_id: "t1",
      workspace_id: "w",
      agent_status: "done",
      ...fields,
    }) as Pane;
  test("reads turn, seen and favourite from the core row", () => {
    expect(
      coreSharedOf(
        "c",
        1,
        pane({ runtime: "herdr-core", turn: 4, seen_turn: 3, favourite: true }),
      ),
    ).toEqual({
      connectionId: "c",
      generation: 1,
      terminal: "t1",
      turn: 4,
      seen: 3,
      favourite: true,
    });
    expect(coreSharedOf("c", 1, pane({ runtime: "herdr-core" }))).toMatchObject(
      { turn: -1, seen: null, favourite: false },
    );
    expect(coreSharedOf("c", 1, pane({ turn: 4 }))).toBeNull();
  });
});
