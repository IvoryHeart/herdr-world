import { expect, test } from "bun:test";
import { createBoardPort } from "./board-port";
import {
  emptyBoardDocument,
  type BoardOp,
  type BoardPatch,
} from "../world/board-store";
import { planBoardPatch } from "../world/board-plan";
import {
  STORAGE_BOUNDS,
  StorageWriteRejected,
  StorageOutcomeUnknown,
} from "./world-protocol";

const payload = (): BoardOp[] =>
  Array.from({ length: 400 }, (_, i) => ({
    op: "note.put",
    note: {
      id: `note-${i}`,
      text: "界".repeat(3800),
      color: "yellow",
      x: 1,
      y: i,
    },
  }));
test.each([false, true])(
  "queued planning=%s reserves its retained payload through guards and releases it after refused writes",
  async (planned) => {
    const release = Promise.withResolvers<void>();
    let sent = 0;
    const board = createBoardPort(emptyBoardDocument(), async () => {
      sent++;
      await release.promise;
      throw new StorageWriteRejected("synthetic writer refusal");
    });
    const ops = payload(),
      retainedBytes = Buffer.byteLength(JSON.stringify(ops));
    expect(retainedBytes * 4).toBeGreaterThan(STORAGE_BOUNDS.queuedBytes);
    const source = planBoardPatch([ops], () => ops);
    const input = () =>
      planned ? planBoardPatch([source], (doc) => source(doc)) : ops;
    const writes = Array.from({ length: 4 }, () => board.patch(input()));
    release.resolve();
    const outcomes = await Promise.allSettled(writes);
    await board.settled();
    expect(
      outcomes.filter(
        (o) =>
          o.status === "rejected" && o.reason.message.includes("admission"),
      ),
    ).toHaveLength(1);
    expect(sent).toBe(3);
    const [after] = await Promise.allSettled([board.patch(input())]);
    expect(after!.status).toBe("rejected");
    expect((after as PromiseRejectedResult).reason.message).toBe(
      "synthetic writer refusal",
    );
    expect(sent).toBe(4);
  },
);

test.each([
  "success",
  "no-op",
  "CAS miss",
  "planning error",
  "write refusal",
  "conflict",
  "unknown",
])("Board planning releases the byte reservation after %s", async (outcome) => {
  const initial = emptyBoardDocument();
  const board = createBoardPort(initial, async <T>() => {
    if (outcome === "write refusal")
      throw new StorageWriteRejected("synthetic refusal");
    if (outcome === "unknown")
      throw new StorageOutcomeUnknown("synthetic lost acknowledgement");
    return {
      document: { ...initial, revision: 1 },
      ...(outcome === "conflict" ? { conflict: "synthetic conflict" } : {}),
    } as T;
  });
  const payload = "x".repeat(STORAGE_BOUNDS.queuedBytes - 2);
  const plan = planBoardPatch([payload], () => {
    if (outcome === "planning error")
      throw new Error("synthetic planning error");
    return outcome === "no-op" ? null : [];
  });
  const first =
    outcome === "CAS miss" ? board.patchIf(99, plan) : board.patch(plan);
  const blocked = board.patch(plan);
  const [, refused] = await Promise.allSettled([first, blocked]);
  await board.settled();
  expect(refused!.status).toBe("rejected");
  expect((refused as PromiseRejectedResult).reason.message).toContain(
    "admission",
  );
  const [again] = await Promise.allSettled([board.patch(plan)]);
  if (again!.status === "rejected")
    expect(again.reason.message).not.toContain("admission");
  else expect(["success", "no-op", "CAS miss"]).toContain(outcome);
});

test("a callback with no payload reservation is refused before planning runs", async () => {
  let called = false;
  const board = createBoardPort(emptyBoardDocument(), async () => {
    throw new Error("unexpected request");
  });
  const [refused] = await Promise.allSettled([
    board.patch((() => {
      called = true;
      return [];
    }) as unknown as BoardPatch),
  ]);
  expect(refused!.status).toBe("rejected");
  expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(
    StorageWriteRejected,
  );
  expect(called).toBe(false);
});
