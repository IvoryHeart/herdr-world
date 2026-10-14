import assert from "node:assert/strict";
import { Bridge } from "../web/src/api";
import { decodeWorldSnapshot } from "../web/src/worldSnapshotDecode";
import { syntheticBridge } from "./bridge-fixture";
import { observe } from "./observations";
import type { TraceState } from "./replay";
export type AssemblyCell = {
  phase: string;
  next: number;
  ordinal: number;
  epoch: number;
  decoded: boolean;
  finished: boolean;
  aborted: boolean;
};
export type AssemblyState = {
  cells: AssemblyCell[];
  epoch: number;
  connected: boolean;
  calls: number;
  acceptedOld: boolean;
};
type Outcome = {
  state: "pending" | "resolved" | "rejected";
  value?: unknown;
  error?: unknown;
};
type Decode = {
  release: PromiseWithResolvers<void>;
  signal: AbortSignal;
  task: Promise<unknown>;
  parts: string[];
};
function payload(cell: number, ordinal: number) {
  return { cell, ordinal, connections: [] };
}
function parts(cell: number, ordinal: number) {
  const json = JSON.stringify(payload(cell, ordinal));
  const width = Math.ceil(json.length / 3);
  return [
    json.slice(0, width),
    json.slice(width, 2 * width),
    json.slice(2 * width),
  ];
}
export async function replayChunkAssembly(
  states: TraceState[],
  BridgeClass = Bridge,
) {
  const witnesses = new Set<string>();
  const outcomes = new Map<number, Outcome>();
  const requests = new Map<number, { id: string; task: Promise<void> }>();
  const decodes = new Map<number, Decode>();
  const allTasks: Promise<void>[] = [];
  const decodeTasks: Promise<unknown>[] = [];
  const requestIds = new Set<string>();
  let delivering = -1;
  let ordinal = 0;
  let errorDuringCleanup: unknown;
  let operationFailure: unknown;
  const fixture = syntheticBridge((incoming, signal) => {
    const request = ordinal;
    const cell = delivering;
    const release = Promise.withResolvers<void>();
    const task = release.promise.then(() =>
      decodeWorldSnapshot(incoming, signal),
    );
    decodes.set(request, { release, signal, task, parts: [...incoming] });
    decodeTasks.push(
      task.catch((error) => {
        if (
          !(
            signal.aborted &&
            error instanceof Error &&
            error.message === "World snapshot decode retired"
          )
        )
          errorDuringCleanup = error;
      }),
    );
    // Identity/content is asserted outside Bridge's catch boundary.
    assert(cell >= 0);
    return task;
  }, BridgeClass);
  try {
    for (const [index, state] of states.entries()) {
      const h = state.target;
      const expected = state.assembly;
      const before = index ? states[index - 1]!.assembly : expected;
      const cell = expected.cells[h];
      const current = fixture.sockets.at(-1)!;
      switch (state.op) {
        case "init":
          break;
        case "call": {
          const outcome: Outcome = { state: "pending" };
          const calling = fixture.bridge.call("world.snapshot", {}, null);
          const message = current.sent.at(-1)!;
          assert.equal(message.method, "world.snapshot");
          assert(
            typeof message.id === "string" && !requestIds.has(message.id),
            "Request ID reused within Bridge lifetime",
          );
          requestIds.add(message.id);
          const task = calling.then(
            (value) => {
              outcome.state = "resolved";
              outcome.value = value;
            },
            (error) => {
              outcome.state = "rejected";
              outcome.error = error;
            },
          );
          outcomes.set(cell!.ordinal, outcome);
          requests.set(cell!.ordinal, { id: message.id, task });
          allTasks.push(task);
          break;
        }
        case "fragment":
        case "duplicate":
        case "outOfOrder":
        case "wrongTotal":
        case "qualifiedChunk":
        case "oldSocket": {
          const prior = before.cells[h]!;
          const n =
            state.op === "duplicate"
              ? prior.next - 1
              : state.op === "outOfOrder"
                ? prior.next + 1
                : prior.next;
          ordinal = prior.ordinal;
          delivering = h;
          const socket =
            state.op === "oldSocket"
              ? fixture.sockets[fixture.sockets.length - 2]!
              : current;
          socket.receive({
            id: requests.get(prior.ordinal)!.id,
            world_snapshot_chunk: {
              index: n,
              total: state.op === "wrongTotal" ? 4 : 3,
              data: parts(h, prior.ordinal)[Math.min(n, 2)]!,
            },
            ...(state.op === "qualifiedChunk"
              ? { connection_id: "synthetic-a" }
              : {}),
          });
          break;
        }
        case "finishDecode":
          decodes.get(cell!.ordinal)!.release.resolve();
          await decodes.get(cell!.ordinal)!.task.catch((error) => {
            if (
              !(
                decodes.get(cell!.ordinal)!.signal.aborted &&
                error.message === "World snapshot decode retired"
              )
            )
              throw error;
          });
          await requests.get(cell!.ordinal)!.task;
          break;
        case "disconnect":
          fixture.bridge.disconnect("Synthetic assembly retirement");
          break;
        case "reconnect":
          fixture.connect();
          break;
        default:
          throw new Error("Unknown chunk assembly action");
      }
      await Promise.resolve();
      observe(
        "assembly.transport.epoch",
        fixture.bridge.connectionEpoch,
        expected.epoch,
      );
      observe(
        "assembly.connected",
        fixture.bridge.status === "connected",
        expected.connected,
      );
      observe("assembly.calls", requestIds.size, expected.calls);
      for (const [h, cell] of expected.cells.entries()) {
        if (!cell.ordinal) continue;
        const decoded = decodes.get(cell.ordinal);
        const outcome = outcomes.get(cell.ordinal)!;
        observe("assembly.decode.starts", !!decoded, cell.decoded);
        if (decoded) {
          observe("assembly.parts", decoded.parts, parts(h, cell.ordinal));
          observe(
            "assembly.decode.aborted",
            decoded.signal.aborted,
            cell.aborted,
          );
        }
        observe(
          "assembly.outcome",
          outcome.state,
          cell.phase === "done"
            ? "resolved"
            : cell.phase === "failed"
              ? "rejected"
              : "pending",
        );
        if (cell.phase === "done")
          observe("assembly.result", outcome.value, payload(h, cell.ordinal));
        if (cell.phase === "failed") {
          assert(outcome.error instanceof Error);
          assert.match(
            outcome.error.message,
            /invalid World snapshot chunk|Synthetic assembly retirement/,
          );
        }
      }
      if (state.op === "finishDecode")
        witnesses.add(cell!.aborted ? "cancelledDecode" : "completed");
      if (
        ["duplicate", "outOfOrder", "wrongTotal", "qualifiedChunk"].includes(
          state.op,
        )
      )
        witnesses.add("malformedRejected");
      if (
        expected.cells.every((cell) =>
          ["collecting", "decoding"].includes(cell.phase),
        )
      )
        witnesses.add("parallelCalls");
      if (state.op === "oldSocket") witnesses.add("oldSocketIgnored");
    }
  } catch (error) {
    operationFailure = error;
  } finally {
    try {
      fixture.bridge.disconnect("Synthetic assembly retirement");
    } finally {
      for (const decode of decodes.values()) decode.release.resolve();
      try {
        await Promise.all([...allTasks, ...decodeTasks]);
      } finally {
        fixture.restore();
      }
    }
  }
  if (errorDuringCleanup !== undefined) throw errorDuringCleanup;
  if (operationFailure !== undefined) throw operationFailure;
  return witnesses;
}
