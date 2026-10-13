import assert from "node:assert/strict";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
  type ReadyRuntimeLease,
} from "../../server/src/connections/manager";
import { observe } from "./observations";
import type { TraceState } from "./replay";

export type ControlState = {
  gen: number;
  phase: string;
  factory: number;
  runtimeFactory: number;
  runtimeGen: number;
  mode: string;
  blocked: boolean;
};
function gate() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type ControlledRuntime = ConnectionRuntime & {
  context: ConnectionRuntimeContext;
  factory: number;
  cleanup: ReturnType<typeof gate>;
  stopCalls: number;
};

export async function replayRuntimeControl(
  states: TraceState[],
  Manager = ConnectionManager,
) {
  const id = "synthetic-managed";
  const peer = "synthetic-default";
  const witnesses = new Set<string>();
  const runtimes: ControlledRuntime[] = [];
  const leases: ReadyRuntimeLease<ControlledRuntime>[] = [];
  const tasks: Promise<unknown>[] = [];
  let reentrantStart: Promise<void> | undefined;
  let reentrantStop: Promise<void> | undefined;
  let shutDown = false;
  let peerConstructed = 0;
  const manager = new Manager<ControlledRuntime>(peer, (status) => {
    if (status.id !== id) return;
    if (status.state === "connecting") {
      reentrantStart = manager.start(id);
      tasks.push(reentrantStart);
    }
    if (status.state === "stopping") {
      reentrantStop = manager.stop(id);
      tasks.push(reentrantStop.catch(() => undefined));
      if (shutDown) {
        const attempt = manager.start(peer).then(
          () => {
            throw new Error("Reentrant peer start bypassed shutdown");
          },
          (error) => {
            assert.match(error.message, /manager is stopping/);
            witnesses.add("shutdownReentry");
          },
        );
        tasks.push(attempt);
      }
    }
  });
  const identity = { id, label: "Synthetic managed", source: "synthetic" };
  const factory =
    (version: number) =>
    (context: ConnectionRuntimeContext): ControlledRuntime => {
      const cleanup = gate();
      const runtime: ControlledRuntime = {
        identity,
        context,
        factory: version,
        cleanup,
        stopCalls: 0,
        startTransport: async () => {},
        startBackground: () => {},
        stop: () => {
          runtime.stopCalls++;
          return cleanup.promise;
        },
      };
      runtimes.push(runtime);
      return runtime;
    };
  manager.register({
    identity: { id: peer, label: "Synthetic default", source: "synthetic" },
    createRuntime: (context) => {
      peerConstructed++;
      return {
        ...factory(0)(context),
        identity: { id: peer, label: "Synthetic default", source: "synthetic" },
      };
    },
  });
  manager.register({ identity, createRuntime: factory(0) });
  let pending: Promise<{ error?: unknown }> | undefined;
  let active: ControlledRuntime | undefined;
  function retain(task: Promise<void>) {
    tasks.push(task.catch(() => undefined));
    pending = task.then(
      () => ({}),
      (error) => ({ error }),
    );
  }
  try {
    for (const [index, state] of states.entries()) {
      const expected = state.control;
      switch (state.op) {
        case "init":
          break;
        case "start": {
          const task = manager.start(id);
          observe("control.reentrant.start", task, reentrantStart);
          await task;
          active = runtimes.at(-1)!;
          leases.push(manager.readyRuntimeLease(id)!);
          witnesses.add("reentrantStart");
          break;
        }
        case "currentError":
          active!.context.reportError(new Error("Synthetic runtime failure"));
          witnesses.add("currentFailure");
          break;
        case "obsoleteError":
          observe(
            "control.obsolete.context",
            active!.context.isCurrent(),
            false,
          );
          active!.context.reportError(new Error("Synthetic obsolete error"));
          break;
        case "stop":
          retain(manager.stop(id));
          break;
        case "replace":
          retain(
            manager.replace({
              identity,
              createRuntime: factory(expected.factory),
            }),
          );
          witnesses.add("replaced");
          if (expected.phase === "down") await pending;
          break;
        case "remove":
          retain(manager.unregister(id));
          if (expected.phase === "removed") await pending;
          break;
        case "shutdown":
          shutDown = true;
          retain(manager.stopAll());
          witnesses.add("stoppedAll");
          if (expected.phase === "down") await pending;
          break;
        case "duplicateStart": {
          const before = runtimes.length;
          await manager.start(id);
          observe("control.duplicate.start", runtimes.length, before);
          witnesses.add("duplicate");
          break;
        }
        case "duplicateStop": {
          const first = manager.stop(id);
          observe("control.duplicate.stop", manager.stop(id), first);
          tasks.push(first.catch(() => undefined));
          witnesses.add("duplicate");
          break;
        }
        case "deniedStart": {
          let denied = false;
          try {
            await manager.start(id);
          } catch (error) {
            assert(error instanceof Error);
            assert.match(
              error.message,
              /unknown connection|being removed|manager is stopping/,
            );
            denied = true;
          }
          observe("control.denied.start", denied, true);
          break;
        }
        case "finishCleanup":
        case "failCleanup": {
          const failing = state.op === "failCleanup";
          if (failing)
            active!.cleanup.reject(new Error("Synthetic cleanup failure"));
          else active!.cleanup.resolve();
          const outcome = await pending!;
          const swallowed = states[index - 1]!.control.mode;
          if (failing && swallowed !== "remove" && swallowed !== "shutdown") {
            assert(outcome.error instanceof Error);
            assert.equal(outcome.error.message, "Synthetic cleanup failure");
          } else assert.equal(outcome.error, undefined);
          active = undefined;
          if (failing) witnesses.add("failedCleanup");
          break;
        }
        case "clearError":
          await manager.stop(id);
          break;
        default:
          throw new Error("Unknown runtime control action");
      }
      const exists = manager.has(id);
      observe("control.membership", exists, expected.phase !== "removed");
      if (!exists) witnesses.add("removed");
      else {
        const status = manager.status(id);
        const phases: Record<string, string> = {
          down: "disconnected",
          ready: "ready",
          stopping: "stopping",
          error: "error",
        };
        observe("control.state", status.state, phases[expected.phase]);
        observe("control.generation", status.generation, expected.gen);
        observe(
          "control.runtime.factory",
          manager
            .currentRuntimes()
            .find((runtime) => runtime.identity.id === id)?.factory ?? -1,
          expected.runtimeFactory,
        );
        observe(
          "control.runtime.generation",
          manager
            .currentRuntimes()
            .find((runtime) => runtime.identity.id === id)?.context
            .generation ?? -1,
          expected.runtimeGen,
        );
        if (status.state === "stopping") {
          observe("control.reentrant.stop.calls", active!.stopCalls, 1);
          observe("control.reentrant.stop", reentrantStop, manager.stop(id));
          witnesses.add("reentrantStop");
        }
      }
      for (const lease of leases)
        observe(
          "control.lease.current",
          lease.isCurrent(),
          exists &&
            expected.phase === "ready" &&
            lease.generation === expected.gen,
        );
      observe("control.peer.constructed", peerConstructed, 0);
    }
  } finally {
    for (const runtime of runtimes) runtime.cleanup.resolve();
    await manager.stopAll();
    await Promise.all(tasks);
  }
  return witnesses;
}
