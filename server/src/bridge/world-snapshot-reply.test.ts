import { expect, test } from "bun:test";
import { WORLD_SNAPSHOT_CHUNK_CHARACTERS } from "../../../shared/worldSnapshotChunks";
import { sendWorldSnapshotReply } from "./world-snapshot-reply";

test("aggregate chunks preserve Unicode and yield for unrelated control work", async () => {
  const messages: Record<string, any>[] = [];
  const result = {
    label: "😀".repeat(WORLD_SNAPSHOT_CHUNK_CHARACTERS),
    revision: 1,
  };
  let controlRan = false;
  const sending = sendWorldSnapshotReply(
    "aggregate",
    result,
    true,
    (payload) => {
      messages.push(JSON.parse(payload));
      if (messages.length === 1)
        setTimeout(() => {
          controlRan = true;
        }, 0);
      if (messages.length === 2) expect(controlRan).toBe(true);
      return true;
    },
  );
  expect(messages).toHaveLength(1);
  await sending;
  expect(
    messages.every(
      (message) =>
        message.id === "aggregate" &&
        message.world_snapshot_chunk.data.length <=
          WORLD_SNAPSHOT_CHUNK_CHARACTERS,
    ),
  ).toBe(true);
  expect(
    JSON.parse(
      messages.map((message) => message.world_snapshot_chunk.data).join(""),
    ),
  ).toEqual(result);
});

test("a retired socket stops an unfinished aggregate without replay", async () => {
  let current = true;
  let count = 0;
  await sendWorldSnapshotReply(
    "retired",
    "x".repeat(WORLD_SNAPSHOT_CHUNK_CHARACTERS * 3),
    true,
    () => {
      count++;
      current = false;
      return true;
    },
    () => current,
  );
  expect(count).toBe(1);
});

test("clients without negotiation receive an ordinary reply", async () => {
  const messages: string[] = [];
  const result = { text: "x".repeat(WORLD_SNAPSHOT_CHUNK_CHARACTERS + 1) };
  await sendWorldSnapshotReply("legacy", result, false, (payload) => {
    messages.push(payload);
    return true;
  });
  expect(messages).toHaveLength(1);
  expect(JSON.parse(messages[0]!)).toEqual({ id: "legacy", result });
});

test("a negotiated sender waits for browser admission before its next bounded batch", async () => {
  const admitted = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  let messages = 0;
  const result = "x".repeat(WORLD_SNAPSHOT_CHUNK_CHARACTERS * 6);
  const sending = sendWorldSnapshotReply(
    "bounded",
    result,
    true,
    () => {
      messages++;
      return true;
    },
    () => true,
    async (index) => {
      expect(index).toBe(3);
      waiting.resolve();
      await admitted.promise;
    },
  );
  // Credit already yields after one bounded batch; per-chunk timers delay it.
  expect(messages).toBe(4);
  const state = await Promise.race([
    waiting.promise.then(() => "waiting"),
    sending.then(() => "finished"),
  ]);
  expect(state).toBe("waiting");
  expect(messages).toBe(4);
  admitted.resolve();
  await sending;
  expect(messages).toBe(7);
});
