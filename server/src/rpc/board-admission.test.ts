import { expect, test } from "bun:test";
import { createBoardPort } from "../storage/board-port";
import { emptyBoardDocument } from "../world/board-store";
import { StorageWriteRejected } from "../storage/world-protocol";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";

test("Board RPC planning accounts for retained multibyte params while validation waits in the queue", async () => {
  const release = Promise.withResolvers<void>();
  let sent = 0;
  const board = createBoardPort(emptyBoardDocument(), async () => {
    sent++;
    await release.promise;
    throw new StorageWriteRejected("synthetic writer refusal");
  });
  const errors: unknown[] = [];
  const writes = Array.from({ length: 4 }, () =>
    handleWorldRpc({
      id: "synthetic-request",
      method: "world.board.patch",
      requestIsCurrent: () => true,
      params: {
        ops: Array.from({ length: 400 }, (_, i) => ({
          op: "note.put",
          note: {
            id: `note-${i}`,
            text: "界".repeat(3800),
            color: "yellow",
            x: 0,
            y: i,
          },
        })),
      },
      services: {
        board: () => board,
        publishBoardChanged: () => {},
        bindBoardRecipients: async () => {},
        logger: { warn: () => {} },
      },
      sendReply: () => true,
      sendError: (_context: string, error: unknown) => errors.push(error),
    } as unknown as BridgeRpcContext),
  );
  release.resolve();
  await Promise.all(writes);
  await board.settled();
  expect(
    errors.filter(
      (e) =>
        e instanceof StorageWriteRejected && e.message.includes("admission"),
    ),
  ).toHaveLength(1);
  expect(sent).toBe(3);
});
