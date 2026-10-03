import { WORLD_SNAPSHOT_MAX_CHUNKS } from "../../../shared/worldSnapshotChunks";

type Waiting = {
  index: number;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
type Transfer = { waiting?: Waiting; close(): void };

/** Socket-local credits bound bulk messages queued ahead of control replies. */
export class WorldSnapshotAdmission {
  private readonly sockets = new WeakMap<object, Map<string, Transfer>>();

  constructor(private readonly timeoutMs = 10000) {}

  open(socket: object, id: string) {
    let transfers = this.sockets.get(socket);
    if (!transfers) {
      transfers = new Map();
      this.sockets.set(socket, transfers);
    }
    if (transfers.has(id) || transfers.size >= 2)
      throw new Error("World snapshot transfer capacity exceeded");
    let closed = false;
    const transfer: Transfer = {
      close: () => {
        if (closed) return;
        closed = true;
        if (transfer.waiting) {
          clearTimeout(transfer.waiting.timer);
          transfer.waiting.reject(new Error("World snapshot transfer retired"));
          transfer.waiting = undefined;
        }
        if (transfers.get(id) === transfer) transfers.delete(id);
      },
    };
    transfers.set(id, transfer);
    return {
      close: transfer.close,
      wait: (index: number): Promise<void> => {
        if (closed)
          return Promise.reject(new Error("World snapshot transfer retired"));
        if (transfer.waiting)
          return Promise.reject(
            new Error("World snapshot admission already pending"),
          );
        return new Promise((resolve, reject) => {
          transfer.waiting = {
            index,
            resolve,
            reject,
            timer: setTimeout(() => {
              transfer.waiting = undefined;
              reject(new Error("World snapshot admission timed out"));
              transfer.close();
            }, this.timeoutMs),
          };
        });
      },
    };
  }

  acknowledge(socket: object, message: unknown): boolean {
    if (
      !message ||
      typeof message !== "object" ||
      !Object.prototype.hasOwnProperty.call(message, "world_snapshot_admitted")
    )
      return false;
    // Credit frames never route downstream and cannot act on another socket.
    const admitted = (message as Record<string, any>).world_snapshot_admitted;
    if (
      Object.keys(message).length !== 1 ||
      !admitted ||
      typeof admitted !== "object" ||
      Object.keys(admitted).length !== 2 ||
      typeof admitted.id !== "string" ||
      !Number.isInteger(admitted.index) ||
      admitted.index < 0 ||
      admitted.index >= WORLD_SNAPSHOT_MAX_CHUNKS
    )
      return true;
    const transfer = this.sockets.get(socket)?.get(admitted.id);
    const waiting = transfer?.waiting;
    if (waiting && waiting.index === admitted.index) {
      transfer!.waiting = undefined;
      clearTimeout(waiting.timer);
      waiting.resolve();
    }
    return true;
  }

  retire(socket: object) {
    this.sockets.get(socket)?.forEach((transfer) => transfer.close());
    this.sockets.delete(socket);
  }
}
