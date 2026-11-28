import { describe, expect, test } from "bun:test";
import {
  WORLD_COMMAND_LIMITS,
  WorldCommandRefused,
  WorldCommands,
  parseWorldCommand,
  type PublishedCommand,
  type WorldCommandInput,
} from "./commands";

type Room = { workspace_id: string; label: string };

/** Synthetic ports: one Herdr host "alpha" and one core host "core-a". */
function harness() {
  let now = 1_000;
  let epoch = 0;
  const rooms = new Map<string, Room[]>([
    ["alpha", [{ workspace_id: "w1", label: "Old" }]],
    ["core-a", [{ workspace_id: "hc:w1", label: "Old" }]],
  ]);
  const sent: WorldCommandInput[] = [];
  const recorded: PublishedCommand[] = [];
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  let publishes = 0;
  let recordFails = false;
  let send: (command: WorldCommandInput) => Promise<void> = async (command) => {
    sent.push(command);
  };
  const commands = new WorldCommands({
    now: () => now,
    runtime: (id) =>
      id === "alpha" ? "herdr" : id === "core-a" ? "herdr-core" : null,
    rooms: (id, generation) =>
      generation === 1 ? (rooms.get(id) ?? null) : null,
    send: (command) => send(command),
    acknowledged: () => ++epoch,
    publish: () => void (publishes += 1),
    record: async (command) => {
      if (recordFails) throw new Error("synthetic storage failure");
      recorded.push(command);
    },
    after(ms, run) {
      const timer = { at: now + ms, run, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
  });
  const input = (
    over: Partial<WorldCommandInput> & {
      connection?: string;
      room?: string;
    } = {},
  ): WorldCommandInput => ({
    id: over.id ?? `c-${Math.random().toString(36).slice(2)}`,
    entity: {
      kind: "room",
      connection_id: over.connection ?? "alpha",
      generation: over.entity?.generation ?? 1,
      room_id: over.room ?? "w1",
    },
    field: "name",
    expected: over.expected ?? "Old",
    value: over.value ?? "New",
  });
  /** An admitted read of a host at an epoch, with the runtime's rooms. */
  const read = (id: string, at: number, generation = 1) =>
    commands.admittedRead({
      connectionId: id,
      generation,
      epoch: at,
      rooms: rooms.get(id) ?? [],
    });
  return {
    commands,
    rooms,
    sent,
    recorded,
    input,
    read,
    epoch: () => epoch,
    publishes: () => publishes,
    setSend: (next: typeof send) => void (send = next),
    failRecords: () => void (recordFails = true),
    advance(ms: number) {
      now += ms;
      for (const timer of timers)
        if (!timer.cancelled && timer.at <= now) {
          timer.cancelled = true;
          timer.run();
        }
    },
  };
}

describe("World commands", () => {
  test("settles only with a read that began after the acknowledgement", async () => {
    const h = harness();
    const answer = await h.commands.submit(h.input({ id: "one" }));
    expect(answer.state).toBe("sent");
    expect(h.sent.map((c) => c.entity.connection_id)).toEqual(["alpha"]);
    // A read from before the acknowledgement saw the old name: no outcome.
    expect(h.read("alpha", h.epoch() - 1)).toBe(false);
    expect(h.commands.published()[0]?.state).toBe("sent");
    h.rooms.set("alpha", [{ workspace_id: "w1", label: "New" }]);
    expect(h.read("alpha", h.epoch())).toBe(true);
    expect(h.commands.published()[0]).toMatchObject({
      id: "one",
      state: "observed",
      observed: "New",
    });
    // Recorded when accepted (before sending), then with its outcome.
    expect(h.recorded.map((c) => [c.id, c.state, c.observed])).toEqual([
      ["one", "accepted", undefined],
      ["one", "observed", "New"],
    ]);
  });

  test("a World-owned store settles as stored", async () => {
    const h = harness();
    await h.commands.submit(
      h.input({ id: "core", connection: "core-a", room: "hc:w1" }),
    );
    h.rooms.set("core-a", [{ workspace_id: "hc:w1", label: "New" }]);
    h.read("core-a", h.epoch());
    expect(h.commands.published()[0]?.state).toBe("stored");
  });

  test("the outcome is delivered when the final value is unchanged", async () => {
    const h = harness();
    // The runtime acknowledged but kept the old name (or another writer
    // put it back): the outcome still arrives, saying what World sees.
    await h.commands.submit(h.input({ id: "same" }));
    expect(h.read("alpha", h.epoch())).toBe(true);
    expect(h.commands.published()[0]).toMatchObject({
      state: "observed",
      observed: "Old",
      detail: "The room shows another name.",
    });
    // That outcome is recorded too, not only a successful one.
    expect(h.recorded.at(-1)).toMatchObject({
      id: "same",
      expected: "Old",
      value: "New",
      state: "observed",
      observed: "Old",
    });
  });

  test("every outcome of an accepted command is recorded; none is sent unrecorded", async () => {
    const h = harness();
    h.setSend(async () => {
      throw new WorldCommandRefused("synthetic runtime refusal");
    });
    await h.commands.submit(h.input({ id: "refused" }));
    h.setSend(async () => undefined);
    await h.commands.submit(h.input({ id: "silent" }));
    h.advance(WORLD_COMMAND_LIMITS.settleMs);
    expect(h.recorded.map((c) => [c.id, c.state])).toEqual([
      ["refused", "accepted"],
      ["refused", "refused"],
      ["silent", "accepted"],
      ["silent", "uncertain"],
    ]);
    // A command World cannot record is refused before it is sent.
    h.failRecords();
    let sent = 0;
    h.setSend(async () => void (sent += 1));
    await expect(
      h.commands.submit(h.input({ id: "unrecorded" })),
    ).rejects.toThrow(WorldCommandRefused);
    expect(sent).toBe(0);
    expect(h.commands.published().map((c) => c.id)).not.toContain("unrecorded");
  });

  test("after a restart, a recorded command that never settled is settled as uncertain", async () => {
    const before = harness();
    await before.commands.submit(before.input({ id: "lost" }));
    const accepted = before.recorded[0]!;
    const after = harness();
    after.commands.recover([
      accepted,
      { ...accepted, id: "done", state: "observed", observed: "New" },
    ]);
    expect(after.commands.published()).toEqual([
      expect.objectContaining({
        id: "lost",
        state: "uncertain",
        detail: "World restarted before it saw the result.",
      }),
    ]);
    expect(after.recorded.map((c) => [c.id, c.state])).toEqual([
      ["lost", "uncertain"],
    ]);
  });

  test("compare-and-set refuses a stale expected value, against the newest in flight", async () => {
    const h = harness();
    await expect(
      h.commands.submit(h.input({ expected: "Something else" })),
    ).rejects.toThrow(WorldCommandRefused);
    expect(h.sent).toEqual([]);
    await h.commands.submit(h.input({ id: "a", value: "Second" }));
    // The browser that saw the pending name may follow it; the old one may not.
    await expect(
      h.commands.submit(h.input({ id: "b", expected: "Old", value: "Third" })),
    ).rejects.toThrow("changed since you looked");
    await h.commands.submit(
      h.input({ id: "c", expected: "Second", value: "Third" }),
    );
    expect(h.sent.map((c) => c.value)).toEqual(["Second", "Third"]);
  });

  test("a duplicate id answers with the same command and sends once", async () => {
    const h = harness();
    const first = await h.commands.submit(h.input({ id: "dup" }));
    const again = await h.commands.submit(h.input({ id: "dup" }));
    expect(again).toEqual(first);
    expect(h.sent).toHaveLength(1);
  });

  test("refusals: unknown host, other generation, missing room, runtime refusal", async () => {
    const h = harness();
    await expect(
      h.commands.submit(h.input({ connection: "nobody" })),
    ).rejects.toThrow("does not manage");
    await expect(
      h.commands.submit(h.input({ entity: { generation: 2 } as never })),
    ).rejects.toThrow("reconnected");
    await expect(h.commands.submit(h.input({ room: "gone" }))).rejects.toThrow(
      "no longer exists",
    );
    h.setSend(async () => {
      throw new WorldCommandRefused("Synthetic refusal");
    });
    const refused = await h.commands.submit(h.input({ id: "r" }));
    expect(refused).toMatchObject({
      state: "refused",
      detail: "Synthetic refusal",
    });
    expect(h.publishes()).toBe(1);
  });

  test("a send error is settled by the read that follows, as failed or applied", async () => {
    const h = harness();
    h.setSend(async () => {
      throw new Error("Synthetic timeout");
    });
    await h.commands.submit(h.input({ id: "lost" }));
    h.read("alpha", h.epoch());
    expect(h.commands.published()[0]).toMatchObject({
      state: "failed",
      detail: "Synthetic timeout",
    });
    // The change did land despite the error: World says so.
    const later = harness();
    later.setSend(async () => {
      throw new Error("Synthetic timeout");
    });
    await later.commands.submit(later.input({ id: "landed" }));
    later.rooms.set("alpha", [{ workspace_id: "w1", label: "New" }]);
    later.read("alpha", later.epoch());
    expect(later.commands.published()[0]?.state).toBe("observed");
  });

  test("recovery: a reconnect or silence settles as uncertain", async () => {
    const h = harness();
    await h.commands.submit(h.input({ id: "gen" }));
    expect(h.read("alpha", h.epoch() + 5, 2)).toBe(true);
    expect(h.commands.published()[0]).toMatchObject({ state: "uncertain" });
    await h.commands.submit(h.input({ id: "quiet", expected: "Old" }));
    h.advance(WORLD_COMMAND_LIMITS.settleMs);
    expect(h.commands.published().find((c) => c.id === "quiet")?.state).toBe(
      "uncertain",
    );
  });

  test("settled outcomes leave after a while; the published list is bounded", async () => {
    const h = harness();
    await h.commands.submit(h.input({ id: "old" }));
    h.read("alpha", h.epoch());
    h.advance(WORLD_COMMAND_LIMITS.settledMs);
    expect(h.commands.published()).toEqual([]);
    const rooms: Room[] = [];
    for (let i = 0; i <= WORLD_COMMAND_LIMITS.published; i += 1)
      rooms.push({ workspace_id: `r${i}`, label: "Old" });
    h.rooms.set("alpha", rooms);
    for (let i = 0; i < WORLD_COMMAND_LIMITS.published; i += 1)
      await h.commands.submit(h.input({ id: `n${i}`, room: `r${i}` }));
    await expect(
      h.commands.submit(
        h.input({ id: "over", room: `r${WORLD_COMMAND_LIMITS.published}` }),
      ),
    ).rejects.toThrow("too many changes");
    expect(h.commands.published()).toHaveLength(WORLD_COMMAND_LIMITS.published);
  });

  test("parse refuses malformed and empty requests", () => {
    expect(() => parseWorldCommand({})).toThrow("invalid World command");
    const base = {
      id: "p",
      entity: {
        kind: "room",
        connection_id: "alpha",
        generation: 1,
        room_id: "w1",
      },
      field: "name",
      expected: "Old",
    };
    expect(() => parseWorldCommand({ ...base, value: "   " })).toThrow(
      "needs a name",
    );
    expect(() =>
      parseWorldCommand({
        ...base,
        value: "x".repeat(WORLD_COMMAND_LIMITS.value + 1),
      }),
    ).toThrow("at most");
    expect(parseWorldCommand({ ...base, value: "  Spaced  " }).value).toBe(
      "Spaced",
    );
  });
});
