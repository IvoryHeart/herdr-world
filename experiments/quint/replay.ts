import assert from "node:assert/strict";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
  type ReadyRuntimeLease,
} from "../../server/src/connections/manager";
import { WorldRuntimeStore } from "../../web/src/world/runtimeStore";
import { admitWorldSpaces } from "../../web/src/world/spaceAdmission";
import type { WorldSpaceObject } from "../../web/src/world/worldObject";
import type { ConnectionStatus } from "../../web/src/api";

type Host = {
  gen: number;
  startGen: number;
  phase: string;
  pending: boolean;
  lease: number;
};
type RefreshState = {
  epoch: number;
  pending: number;
  queued: boolean;
  admitted: number;
  issued: number;
  revision: number;
  status: string;
};
export type TraceState = {
  op: string;
  target: number;
  hosts: Host[];
  s: RefreshState;
  present: number[];
  relevant: number[];
  bound: number;
  admitted: number[];
};

// Decode only the ITF types these models emit. Reject unsupported tags rather
// than silently treating encoded maps/sets as production objects.
export function decodeItf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeItf);
  if (value === null || typeof value !== "object") return value;
  const entry = value as Record<string, unknown>;
  if ("#bigint" in entry) {
    const result = Number(entry["#bigint"]);
    assert(Number.isSafeInteger(result), "ITF integer exceeds JS domain");
    return result;
  }
  if ("#set" in entry) return decodeItf(entry["#set"]);
  assert(
    !Object.keys(entry).some((key) => key.startsWith("#") && key !== "#meta"),
    "unsupported ITF tag",
  );
  return Object.fromEntries(
    Object.entries(entry)
      .filter(([key]) => key !== "#meta")
      .map(([key, item]) => [key, decodeItf(item)]),
  );
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Runtime = ConnectionRuntime & {
  context: ConnectionRuntimeContext;
  transport: ReturnType<typeof deferred<void>>;
  cleanup: ReturnType<typeof deferred<void>>;
};

export async function replayRuntime(
  states: TraceState[],
  Manager = ConnectionManager,
) {
  const ids = ["synthetic-a", "synthetic-b"];
  const manager = new Manager<Runtime>(ids[0]!);
  const runtimes = new Map<number, Runtime>();
  const starts = new Map<number, Promise<void>>();
  const stops = new Map<number, Promise<void>>();
  const leases: ReadyRuntimeLease<Runtime>[] = [];
  const captured = new Map<number, Runtime>();
  for (const [h, id] of ids.entries()) {
    manager.register({
      identity: { id, label: id, source: "synthetic" },
      createRuntime: (context) => {
        const transport = deferred();
        const cleanup = deferred();
        const runtime: Runtime = {
          identity: { id, label: id, source: "synthetic" },
          context,
          transport,
          cleanup,
          startTransport: () => transport.promise,
          startBackground: () => {},
          stop: () => cleanup.promise,
        };
        runtimes.set(h, runtime);
        return runtime;
      },
    });
  }
  try {
    for (const [index, state] of states.entries()) {
      const h = state.target;
      const id = ids[h]!;
      switch (state.op) {
        case "init":
          break;
        case "start":
          starts.set(h, manager.start(id));
          break;
        case "finishStart":
          runtimes.get(h)!.transport.resolve();
          await starts.get(h);
          break;
        case "capture": {
          const lease = manager.readyRuntimeLease(id);
          assert(lease);
          leases.push(lease);
          captured.set(h, lease.runtime);
          break;
        }
        case "stop":
          stops.set(h, manager.stop(id));
          break;
        case "finishStop":
          runtimes.get(h)!.cleanup.resolve();
          await stops.get(h);
          break;
        case "obsoleteError":
          captured
            .get(h)!
            .context.reportError(new Error("synthetic obsolete callback"));
          break;
        default:
          throw new Error(`unknown runtime action ${state.op}`);
      }
      for (const [peer, expected] of state.hosts.entries()) {
        const actual = manager.status(ids[peer]!);
        const phases: Record<string, string> = {
          down: "disconnected",
          starting: "connecting",
          ready: "ready",
          stopping: "stopping",
        };
        assert.equal(
          actual.state,
          phases[expected.phase],
          `state ${index}, host ${peer}`,
        );
        assert.equal(
          actual.generation,
          expected.gen,
          `generation ${index}, host ${peer}`,
        );
        assert.equal(
          manager.readyRuntimeLease(ids[peer]!) !== null,
          expected.phase === "ready",
        );
      }
      for (const lease of leases) {
        const owner = state.hosts[ids.indexOf(lease.connectionId)]!;
        assert.equal(
          lease.isCurrent(),
          owner.phase === "ready" && owner.gen === lease.generation,
        );
      }
    }
  } finally {
    // Drain actual tasks, including traces ending in mid-start or mid-stop.
    for (const runtime of runtimes.values()) {
      runtime.transport.resolve();
      runtime.cleanup.resolve();
    }
    await Promise.all(starts.values());
    await Promise.all(stops.values());
    await manager.stopAll();
  }
}

export async function replayRefresh(
  states: TraceState[],
  Store = WorldRuntimeStore,
) {
  let issued = 0;
  let epoch = 0;
  let statusListener: ((status: ConnectionStatus) => void) | undefined;
  const calls = new Map<number, ReturnType<typeof deferred<unknown>>>();
  const owners = new Map<number, Promise<void>>();
  class RecordingStore extends Store {
    // Instrument only the public entry point, including automatic follow-ups.
    // Do not read or modify private coordination state.
    override refresh() {
      const before = issued;
      const task = super.refresh();
      if (issued !== before) owners.set(issued, task);
      return task;
    }
  }
  const store = new RecordingStore({
    call: async (method) => {
      assert.equal(method, "world.snapshot");
      assert.equal(calls.size, 0, "more than one request in flight");
      const gate = deferred<unknown>();
      calls.set(++issued, gate);
      return gate.promise;
    },
    onControl: () => () => {},
    onStatus: (listener) => {
      statusListener = listener;
      return () => {};
    },
  });
  store.start();
  const response = (revision: number) => ({
    revision,
    observed_at: revision,
    connections: [
      {
        connection_id: "synthetic-a",
        label: "Synthetic A",
        source: "synthetic",
        is_default: true,
        state: "ready",
        generation: 1,
        snapshot_generation: null,
        stale: false,
        actionable: true,
        snapshot: null,
      },
    ],
  });
  try {
    for (const [index, state] of states.entries()) {
      switch (state.op) {
        case "init":
          break;
        case "refresh":
          void store.refresh();
          break;
        case "disconnect":
          epoch++;
          statusListener!("disconnected");
          break;
        case "complete": {
          const request = issued;
          const gate = calls.get(request)!;
          calls.delete(request);
          gate.resolve(response(request));
          await owners.get(request);
          break;
        }
        default:
          throw new Error(`unknown refresh action ${state.op}`);
      }
      const actual = store.get();
      assert.equal(actual.status, state.s.status, `refresh status at ${index}`);
      assert.equal(
        actual.revision,
        state.s.revision,
        `refresh revision at ${index}`,
      );
      assert.equal(issued, state.s.issued, `request count at ${index}`);
      assert.equal(
        calls.size,
        state.s.pending >= 0 ? 1 : 0,
        `pending count at ${index}`,
      );
      assert.equal(epoch, state.s.epoch);
      if (actual.connections.length) {
        assert.equal(
          actual.connections[0]!.actionable,
          state.s.status === "ready",
        );
      }
    }
  } finally {
    store.stop();
    for (const [request, gate] of calls) gate.resolve(response(request));
    await Promise.all(owners.values());
  }
}

export function replaySpaces(
  states: TraceState[],
  allocate = admitWorldSpaces,
) {
  const hosts = [0, 0, 0, 1, 1, 2];
  for (const state of states) {
    const relevant = new Set(state.relevant);
    const ordered = [...state.present]
      .sort((a, b) => a - b)
      .map((id) => ({
        id,
        hostIndex: hosts[id]!,
        space: {
          id: `synthetic-space-${id}`,
          workspace: { focused: relevant.has(id) },
          children: [],
        } as unknown as WorldSpaceObject,
      }));
    const actual = allocate(ordered, state.bound, null).map(({ id }) => id);
    assert.deepEqual(
      [...actual].sort((a, b) => a - b),
      [...state.admitted].sort((a, b) => a - b),
    );
    assert.equal(new Set(actual).size, actual.length);
    const priority = ordered
      .filter(({ id }) => relevant.has(id))
      .slice(0, state.bound)
      .map(({ id }) => id);
    assert.deepEqual(actual.slice(0, priority.length), priority);
  }
}
