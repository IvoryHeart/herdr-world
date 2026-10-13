import { expect, test } from "bun:test";
import { WorldSnapshotAdmission } from "../../server/src/bridge/world-snapshot-admission";
import { replayChunkCredits, type CreditState } from "./chunk-credits";
import { parseTrace } from "./traces";

test("credit replay exercises overflow, reuse, wrong socket/index and already-resolved retirement", async () => {
  let state: CreditState = {
    slots: Array.from({ length: 4 }, () => ({ phase: "new", index: -1 })),
    live: [true, true],
    socket: -1,
    id: -1,
    index: -1,
    released: false,
    rejected: false,
    releasedSocket: -1,
    releasedIndex: -1,
    releasedId: -1,
  };
  const states = [{ ...state, op: "init" }];
  const event = (
    op: string,
    socket: number,
    id: number,
    index: number,
    change: Partial<CreditState> = {},
    slot?: { phase: string; index: number },
  ) => {
    const slots = state.slots.map((value) => ({ ...value }));
    if (slot) slots[socket === 0 ? id : 3] = slot;
    state = {
      ...state,
      slots,
      socket,
      id,
      index,
      released: false,
      rejected: false,
      releasedSocket: -1,
      releasedIndex: -1,
      releasedId: -1,
      ...change,
    };
    states.push({ ...state, op });
  };
  event("open", 0, 0, -1, {}, { phase: "open", index: -1 });
  event("wait", 0, 0, 0, {}, { phase: "waiting", index: 0 });
  event("acknowledge", 1, 0, 0);
  event("wait", 0, 0, 1, { rejected: true });
  event("acknowledge", 0, 0, 1);
  event("open", 0, 1, -1, {}, { phase: "open", index: -1 });
  event("open", 0, 2, -1, { rejected: true });
  event("close", 0, 1, -1, {}, { phase: "closed", index: -1 });
  event("open", 0, 2, -1, {}, { phase: "open", index: -1 });
  event(
    "acknowledge",
    0,
    0,
    0,
    { released: true, releasedSocket: 0, releasedIndex: 0, releasedId: 0 },
    { phase: "open", index: -1 },
  );
  event("close", 0, 0, -1, {}, { phase: "closed", index: -1 });
  event("wait", 0, 0, 1, { rejected: true });
  event("open", 1, 0, -1, {}, { phase: "open", index: -1 });
  event("wait", 1, 0, 2, {}, { phase: "waiting", index: 2 });
  event("retire", 1, -1, -1, {
    rejected: true,
    live: [true, false],
    slots: state.slots.map((slot, key) =>
      key === 3 ? { phase: "closed", index: -1 } : slot,
    ),
  });
  const witnesses = await replayChunkCredits(
    parseTrace("chunk-credits", JSON.stringify({ states })),
  );
  for (const name of [
    "wrongSocket",
    "duplicateWait",
    "wrongIndex",
    "capacityDenied",
    "capacityReused",
    "retirementCancelled",
  ])
    expect(witnesses.has(name)).toBe(true);
});

test("a retained closed handle cannot close a new transfer with the same ID", async () => {
  const admission = new WorldSnapshotAdmission();
  const socket = {};
  const old = admission.open(socket, "synthetic-id");
  old.close();
  const current = admission.open(socket, "synthetic-id");
  try {
    old.close();
    await expect(old.wait(3)).rejects.toThrow("retired");
    const waiting = current.wait(3);
    admission.acknowledge(socket, {
      world_snapshot_admitted: { id: "synthetic-id", index: 3 },
    });
    await waiting;
  } finally {
    admission.retire(socket);
  }
});
