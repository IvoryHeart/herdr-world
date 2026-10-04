import { expect, test } from "bun:test";
import { WorldSnapshotAdmission } from "./world-snapshot-admission";

test("snapshot credits are fenced by socket, request and expected index", async () => {
  const admission = new WorldSnapshotAdmission();
  const socket = {},
    sibling = {};
  const transfer = admission.open(socket, "same");
  let released = false;
  const waiting = transfer.wait(3).then(() => {
    released = true;
  });
  const credit = { world_snapshot_admitted: { id: "same", index: 3 } };
  admission.acknowledge(sibling, credit);
  admission.acknowledge(socket, {
    world_snapshot_admitted: { id: "other", index: 3 },
  });
  admission.acknowledge(socket, {
    world_snapshot_admitted: { id: "same", index: 7 },
  });
  admission.acknowledge(socket, { ...credit, connection_id: "other" });
  await Promise.resolve();
  expect(released).toBe(false);
  expect(admission.acknowledge(socket, credit)).toBe(true);
  await waiting;
  expect(released).toBe(true);
  const next = transfer.wait(7);
  admission.acknowledge(socket, credit);
  admission.acknowledge(socket, {
    world_snapshot_admitted: { id: "same", index: 7 },
  });
  await next;
  transfer.close();
});

test("socket retirement cancels waiting transfers and capacity is reusable", async () => {
  const admission = new WorldSnapshotAdmission();
  const socket = {};
  const first = admission.open(socket, "first");
  const second = admission.open(socket, "second");
  expect(() => admission.open(socket, "third")).toThrow("capacity");
  expect(() => admission.open(socket, "first")).toThrow("capacity");
  const waiting = first.wait(3);
  admission.retire(socket);
  await expect(waiting).rejects.toThrow("retired");
  await expect(second.wait(3)).rejects.toThrow("retired");
  admission.open(socket, "first").close();
});

test("missing browser admission times out and releases transfer capacity", async () => {
  const admission = new WorldSnapshotAdmission(5);
  const socket = {};
  const transfer = admission.open(socket, "missing");
  await expect(transfer.wait(3)).rejects.toThrow("timed out");
  admission.open(socket, "missing").close();
  expect(admission.acknowledge(socket, { method: "terminal.input" })).toBe(
    false,
  );
});
