import type { BaseState } from "./observation-base";
import type { DrainState } from "./runtime-drain";
import type { CreditState } from "./chunk-credits";
import type { AssemblyState } from "./chunk-assembly";
import type { CreationState } from "./creation-flow";
import type { AuthorityState } from "./ranger-authority";
import type { RecoveryState } from "./ranger-recovery";
import assert from "node:assert/strict";
import type { PreparationState } from "./browser-preparation";
import type { ControlState } from "./runtime-control";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
  type ReadyRuntimeLease,
} from "../server/src/connections/manager";
import { WorldRuntimeStore } from "../web/src/world/runtimeStore";
import { admitWorldSpaces } from "../web/src/world/spaceAdmission";
import type { WorldSpaceObject } from "../web/src/world/worldObject";
import type { ConnectionStatus } from "../web/src/api";
import { observe } from "./observations";

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
export type TraceState = CreditState & {
  recovery: RecoveryState;
  authority: AuthorityState;
  creation: CreationState;
  assembly: AssemblyState;
  control: ControlState;
  drain: DrainState;
  preparation: PreparationState;
  op: string;
  target: number;
  hosts: Host[];
  s: RefreshState & BaseState;
  host: number;
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
    assert(
      Object.keys(entry).every((key) => key === "#bigint" || key === "#meta"),
      "unsupported ITF tag",
    );
    assert(
      typeof entry["#bigint"] === "string" && /^-?\d+$/.test(entry["#bigint"]),
      "invalid ITF integer",
    );
    const result = Number(entry["#bigint"]);
    assert(Number.isSafeInteger(result), "ITF integer exceeds JS domain");
    return result;
  }
  if ("#set" in entry) {
    assert(
      Object.keys(entry).every((key) => key === "#set" || key === "#meta"),
      "unsupported ITF tag",
    );
    assert(Array.isArray(entry["#set"]), "invalid ITF set");
    return decodeItf(entry["#set"]);
  }
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
  reverseRegistration = false,
) {
  const witnesses = new Set<string>();
  const ids = ["synthetic-a", "synthetic-b"];
  const manager = new Manager<Runtime>(ids[0]!);
  const runtimes = new Map<number, Runtime>();
  const starts = new Map<number, Promise<void>>();
  const stops = new Map<number, Promise<void>>();
  const leases: ReadyRuntimeLease<Runtime>[] = [];
  const captured = new Map<number, Runtime>();
  const registrations = [...ids.entries()];
  if (reverseRegistration) registrations.reverse();
  for (const [h, id] of registrations) {
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
          if (manager.status(id).state === "stopping")
            witnesses.add("lateStart");
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
          assert(
            !captured.get(h)!.context.isCurrent(),
            "obsolete callback must actually be retired",
          );
          witnesses.add("obsoleteCallback");
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
        const context = `state ${index}, host ${peer}`;
        observe("runtime.state", actual.state, phases[expected.phase], context);
        observe("runtime.generation", actual.generation, expected.gen, context);
        observe(
          "runtime.readyLease",
          manager.readyRuntimeLease(ids[peer]!) !== null,
          expected.phase === "ready",
          context,
        );
      }
      for (const lease of leases) {
        const owner = state.hosts[ids.indexOf(lease.connectionId)]!;
        observe(
          "runtime.lease.current",
          lease.isCurrent(),
          owner.phase === "ready" && owner.gen === lease.generation,
          `state ${index}`,
        );
      }
      if (manager.list().every((status) => status.state === "ready"))
        witnesses.add("twoReady");
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
  return witnesses;
}

export async function replayRefresh(
  states: TraceState[],
  Store = WorldRuntimeStore,
) {
  const witnesses = new Set<string>();
  let issued = 0;
  let epoch = 0;
  let statusListener: ((status: ConnectionStatus) => void) | undefined;
  const calls = new Map<number, ReturnType<typeof deferred<unknown>>>();
  const owners = new Map<number, Promise<void>>();
  const requestEpochs = new Map<number, number>();
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
      requestEpochs.set(issued, epoch);
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
          if (requestEpochs.get(request) !== epoch) witnesses.add("lateReply");
          const gate = calls.get(request)!;
          calls.delete(request);
          gate.resolve(response(request));
          await owners.get(request);
          if (issued > request) witnesses.add("coalescedFollowup");
          break;
        }
        default:
          throw new Error(`unknown refresh action ${state.op}`);
      }
      const actual = store.get();
      observe(
        "refresh.status",
        actual.status,
        state.s.status,
        `state ${index}`,
      );
      observe(
        "refresh.revision",
        actual.revision,
        state.s.revision,
        `state ${index}`,
      );
      assert.equal(issued, state.s.issued, `request count at ${index}`);
      assert.equal(
        calls.size,
        state.s.pending >= 0 ? 1 : 0,
        `pending count at ${index}`,
      );
      assert.equal(epoch, state.s.epoch);
      const admitted = state.s.admitted >= 0;
      observe(
        "refresh.connections.count",
        actual.connections.length,
        admitted ? 1 : 0,
        `state ${index}`,
      );
      if (admitted) {
        const connection = actual.connections[0]!;
        observe(
          "refresh.connection.id",
          connection.connectionId,
          "synthetic-a",
          `state ${index}`,
        );
        observe(
          "refresh.connection.generation",
          connection.generation,
          1,
          `state ${index}`,
        );
        observe(
          "refresh.connection.actionable",
          connection.actionable,
          state.s.status === "ready",
          `state ${index}`,
        );
      }
      if (witnesses.has("lateReply") && actual.status === "ready")
        witnesses.add("restored");
    }
  } finally {
    store.stop();
    for (const [request, gate] of calls) gate.resolve(response(request));
    await Promise.all(owners.values());
  }
  return witnesses;
}

export function replaySpaces(
  states: TraceState[],
  allocate = admitWorldSpaces,
  order = [0, 1, 2, 3, 4, 5],
) {
  const witnesses = new Set<string>();
  const hosts = [0, 0, 0, 1, 1, 2];
  for (const state of states) {
    const relevant = new Set(state.relevant);
    const ordered = [...state.present]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
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
    observe(
      "spaces.membership",
      [...actual].sort((a, b) => a - b),
      [...state.admitted].sort((a, b) => a - b),
    );
    observe("spaces.unique", new Set(actual).size, actual.length);
    const priority = ordered
      .filter(({ id }) => relevant.has(id))
      .slice(0, state.bound)
      .map(({ id }) => id);
    observe("spaces.priority", actual.slice(0, priority.length), priority);
    if (
      actual.some((id) => relevant.has(id)) &&
      actual.some((id) => !relevant.has(id))
    )
      witnesses.add("mixedPriority");
    if (new Set(actual.map((id) => hosts[id])).size === 3)
      witnesses.add("allHosts");
  }
  return witnesses;
}
