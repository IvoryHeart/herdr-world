import assert from "node:assert/strict";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "../../server/src/connections/manager";
import { observe } from "./observations";
import type { TraceState } from "./replay";
export type DrainState = {
  kind: number;
  cleanupFirst: boolean;
  failed: boolean;
  phase: string;
  gen: number;
  transportDone: boolean;
  backgroundWait: boolean;
  backgroundFailed: boolean;
  backgroundDone: boolean;
  cleanupDone: boolean;
  readySeen: boolean;
  stage: string;
};
type Runtime = ConnectionRuntime & {
  context: ConnectionRuntimeContext;
  transport: PromiseWithResolvers<void>;
  cleanup: PromiseWithResolvers<void>;
  stopEntered: PromiseWithResolvers<void>;
  backgrounds: number;
  background: PromiseWithResolvers<void>;
  backgroundEntered: PromiseWithResolvers<void>;
};
export async function replayRuntimeDrain(
  states: TraceState[],
  Manager = ConnectionManager,
) {
  const witnesses = new Set<string>();
  const id = "synthetic-managed";
  const peer = "synthetic-default";
  const identity = { id, label: id, source: "synthetic" };
  let manager: ConnectionManager<Runtime> | undefined;
  let runtime: Runtime | undefined;
  let start: Promise<{ error?: unknown }> | undefined;
  let operation: Promise<{ error?: unknown }> | undefined;
  let readySeen = false;
  let constructions = 0;
  const tasks: Promise<unknown>[] = [];
  async function completeCleanup(failed: boolean) {
    await runtime!.stopEntered.promise;
    if (failed) runtime!.cleanup.reject(new Error("Synthetic cleanup failure"));
    else runtime!.cleanup.resolve();
  }
  async function completeTransport(state: DrainState) {
    if (state.backgroundWait) {
      if (state.backgroundFailed)
        runtime!.background.reject(new Error("Synthetic background failure"));
      else runtime!.background.resolve();
    } else runtime!.transport.resolve();
    await start;
  }
  async function finish(state: DrainState) {
    const started = await start!;
    const retired = await operation!;
    if (state.kind === 5 || state.backgroundFailed) {
      assert(started.error instanceof Error);
      assert.equal(
        started.error.message,
        state.kind === 5
          ? "Synthetic transport failure"
          : "Synthetic background failure",
      );
    } else assert.equal(started.error, undefined);
    if (state.failed && state.kind < 2) {
      assert(retired.error instanceof Error);
      assert.equal(retired.error.message, "Synthetic cleanup failure");
    } else assert.equal(retired.error, undefined);
    observe(
      "drain.background",
      runtime!.backgrounds,
      state.backgroundWait ? 1 : 0,
    );
    if (state.backgroundWait) witnesses.add("retiredDuringBackground");
    if (state.backgroundFailed) witnesses.add("failedBackground");
    const named = [
      "stoppedDuringStart",
      "replacedDuringStart",
      "removedDuringStart",
      "shutdownDuringStart",
      "currentErrorDuringStart",
      "failedStart",
    ][state.kind]!;
    witnesses.add(named);
    witnesses.add(
      state.cleanupFirst ? "cleanupBeforeTransport" : "transportBeforeCleanup",
    );
    if (state.failed) witnesses.add("failedDrain");
  }
  try {
    for (const state of states) {
      const expected = state.drain;
      switch (state.op) {
        case "init":
          break;
        case "choose": {
          if (manager) await manager.stopAll();
          readySeen = false;
          constructions = 0;
          manager = new Manager<Runtime>(peer, (status) => {
            if (status.id === id && status.state === "ready") readySeen = true;
          });
          const createRuntime = (
            context: ConnectionRuntimeContext,
          ): Runtime => {
            constructions++;
            const next: Runtime = {
              identity,
              context,
              transport: Promise.withResolvers<void>(),
              cleanup: Promise.withResolvers<void>(),
              stopEntered: Promise.withResolvers<void>(),
              backgrounds: 0,
              background: Promise.withResolvers<void>(),
              backgroundEntered: Promise.withResolvers<void>(),
              startTransport: () => next.transport.promise,
              startBackground: () => {
                next.backgrounds++;
                next.backgroundEntered.resolve();
                if (expected.backgroundWait) return next.background.promise;
              },
              stop: () => {
                next.stopEntered.resolve();
                return next.cleanup.promise;
              },
            };
            runtime = next;
            return next;
          };
          manager.register({
            identity: { id: peer, label: peer, source: "synthetic" },
            createRuntime,
          });
          manager.register({ identity, createRuntime });
          const task = manager.start(id);
          start = task.then(
            () => ({}),
            (error) => ({ error }),
          );
          tasks.push(start);
          break;
        }
        case "enterBackground":
          runtime!.transport.resolve();
          await runtime!.backgroundEntered.promise;
          break;
        case "retire": {
          let task: Promise<void>;
          if (expected.kind === 0) task = manager!.stop(id);
          else if (expected.kind === 1)
            task = manager!.replace({
              identity,
              createRuntime: () => {
                constructions++;
                throw new Error(
                  "Replacement must not be constructed during retirement",
                );
              },
            });
          else if (expected.kind === 2) task = manager!.unregister(id);
          else if (expected.kind === 3) task = manager!.stopAll();
          else if (expected.kind === 4) {
            runtime!.context.reportError(
              new Error("Synthetic current runtime failure"),
            );
            task = manager!.retireFailedRuntime(id);
          } else {
            runtime!.transport.reject(new Error("Synthetic transport failure"));
            await runtime!.stopEntered.promise;
            task = start!.then(() => {});
          }
          operation = task.then(
            () => ({}),
            (error) => ({ error }),
          );
          tasks.push(operation);
          break;
        }
        case "finishFirst":
          if (expected.cleanupFirst) await completeCleanup(expected.failed);
          else await completeTransport(expected);
          break;
        case "finishSecond":
          if (expected.kind === 5 || !expected.cleanupFirst)
            await completeCleanup(expected.failed);
          else await completeTransport(expected);
          await finish(expected);
          break;
        default:
          throw new Error("Unknown lifecycle drain action");
      }
      if (!manager) continue;
      observe("drain.ready.seen", readySeen, expected.readySeen);
      observe("drain.constructions", constructions, 1);
      observe(
        "drain.membership",
        manager.has(id),
        expected.phase !== "removed",
      );
      if (manager.has(id)) {
        observe("drain.state", manager.status(id).state, expected.phase);
        observe(
          "drain.generation",
          manager.status(id).generation,
          expected.gen,
        );
        observe("drain.ready.lease", manager.readyRuntimeLease(id), null);
      }
    }
  } finally {
    runtime?.transport.resolve();
    runtime?.background.resolve();
    runtime?.cleanup.resolve();
    await Promise.all(tasks);
    await manager?.stopAll();
  }
  return witnesses;
}
