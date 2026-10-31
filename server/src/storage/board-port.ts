import {
  BoardConflictError,
  type BoardDocument,
  type BoardPatch,
  type BoardStorePort,
} from "../world/board-store";
import {
  captureAppearanceChanges,
  trackAppearanceEdits,
  type AppearanceEdits,
} from "../world/appearance-edits";
import { trackColorEdits, type ColorEdit } from "../world/board-color-moves";
import {
  StorageOutcomeUnknown,
  StorageWriteRejected,
  STORAGE_BOUNDS,
  type StorageRequest,
} from "./world-protocol";
import type { BoardCommit } from "./world-board";
export function createBoardPort(
  initial: BoardDocument | null,
  request: <T>(operation: StorageRequest) => Promise<T>,
): BoardStorePort {
  let document = initial && structuredClone(initial),
    closed = false,
    uncertain: StorageOutcomeUnknown | undefined,
    tail = Promise.resolve(),
    pending = 0,
    pendingBytes = 0;
  const colors = new Map<string, ColorEdit>(),
    appearances: AppearanceEdits = new Map();
  const get = () => {
    if (!document) throw new Error("World Board was not initialized");
    return structuredClone(document);
  };
  function write(
    input: BoardPatch,
    revision?: number,
  ): Promise<BoardDocument | null> {
    if (closed)
      return Promise.reject(
        new StorageWriteRejected("World storage is closed"),
      );
    if (pending >= STORAGE_BOUNDS.queuedOperations)
      return Promise.reject(
        new StorageWriteRejected("Board admission limit reached"),
      );
    const bytes =
      typeof input === "function"
        ? input.retainedBytes
        : Buffer.byteLength(
            JSON.stringify({
              type: "board",
              operation: {
                ops: input,
                ...(revision === undefined ? {} : { revision }),
              },
            }),
          );
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > STORAGE_BOUNDS.boardRequestBytes ||
      pendingBytes + bytes > STORAGE_BOUNDS.queuedBytes
    )
      return Promise.reject(
        new StorageWriteRejected("Board admission limit reached"),
      );
    const build = typeof input === "function" ? input : structuredClone(input);
    pending++;
    pendingBytes += bytes;
    const result = tail.then(async () => {
      if (uncertain) throw uncertain;
      if (revision !== undefined && get().revision !== revision) return null;
      const ops = structuredClone(
        typeof build === "function" ? build(get()) : build,
      );
      if (ops === null) return revision === undefined ? get() : null;
      const reply = await request<BoardCommit>({
        type: "board",
        operation: { ops, ...(revision === undefined ? {} : { revision }) },
      });
      if (reply.conflict)
        throw new BoardConflictError(reply.conflict, reply.document!);
      if (reply.document) {
        document = reply.document;
        trackColorEdits(colors, ops, document);
        trackAppearanceEdits(appearances, ops, document);
      }
      return reply.document && structuredClone(reply.document);
    });
    tail = result.then(
      () => {
        pending--;
        pendingBytes -= bytes;
      },
      (error) => {
        pending--;
        pendingBytes -= bytes;
        if (error instanceof StorageOutcomeUnknown) uncertain = error;
      },
    );
    return result;
  }
  return {
    get,
    patch: (input) => write(input).then((doc) => doc!),
    patchIf: writeIf,
    captureColorChanges: () => {
      const before = new Map(colors);
      return (key) => {
        const edit = colors.get(key);
        return edit && before.get(key)?.revision !== edit.revision
          ? edit.color
          : undefined;
      };
    },
    captureAppearanceChanges: () =>
      captureAppearanceChanges(appearances, get().revision, () => document!),
    settled: () => tail,
    close: () => {
      closed = true;
    },
  };
  function writeIf(revision: number, input: BoardPatch) {
    return write(input, revision);
  }
}
