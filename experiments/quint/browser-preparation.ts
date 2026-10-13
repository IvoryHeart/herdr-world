import assert from "node:assert/strict";
import { WorldRuntimeStore } from "../../web/src/world/runtimeStore";
import { observe } from "./observations";
import type { TraceState } from "./replay";

export type PreparationState = {
  epoch: number;
  captured: number;
  stage: string;
  issued: number;
  revision: number;
  published: number;
  status: string;
  catalogue: boolean;
  queued: boolean;
  selected: number;
  requested: number;
  live: boolean[];
  actionable: boolean[];
};
function deferred<T>() {
  return Promise.withResolvers<T>();
}

export async function replayBrowserPreparation(
  states: TraceState[],
  Store = WorldRuntimeStore,
) {
  const witnesses = new Set<string>();
  const ids = ["synthetic-a", "synthetic-b"];
  const live = [true, true];
  let issued = 0;
  let capturedHint = -1;
  const owners = new Map<number, Promise<void>>();
  let status!: (status: "connected" | "disconnected") => void;
  let request: ReturnType<typeof deferred<unknown>> | undefined;
  let owner: Promise<void> | undefined;
  let paused: { stage: string; release: () => void } | undefined;
  let nextPause = deferred<string>();
  let stages = new Set<string>();
  let retiring = false;
  class RecordingStore extends Store {
    override refresh() {
      const before = issued;
      const task = super.refresh();
      if (issued > before) owners.set(issued, task);
      return task;
    }
  }
  const store = new RecordingStore(
    {
      call: async (method, params) => {
        assert.equal(method, "world.snapshot");
        assert(!request);
        issued++;
        const hint = (params as { selected_connection_id?: string })
          ?.selected_connection_id;
        capturedHint = hint === undefined ? -1 : ids.indexOf(hint);
        stages = new Set();
        request = deferred<unknown>();
        return request.promise;
      },
      connection: (id) => ({ isCurrent: () => live[ids.indexOf(id)] === true }),
      onControl: () => () => {},
      onStatus: (listener) => {
        status = listener;
        return () => {};
      },
    },
    async (stage) => {
      if (retiring || stages.has(stage)) return;
      stages.add(stage);
      const release = deferred<void>();
      paused = { stage, release: () => release.resolve() };
      nextPause.resolve(stage);
      await release.promise;
    },
  );
  const response = () => ({
    revision: issued,
    observed_at: issued,
    connections: ids.map((id, h) => ({
      connection_id: id,
      label: id,
      source: "synthetic",
      is_default: h === 0,
      state: "ready",
      generation: 1,
      snapshot_generation: 1,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [],
        tabs: [],
        panes: [],
        agents: [],
        coverage: {
          workspaces: 0,
          tabs: 0,
          panes: 0,
          agent_panes: 0,
          status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
          by_workspace: [],
        },
      },
    })),
  });
  async function completed() {
    await Promise.race([
      owner!,
      nextPause.promise.then((stage) =>
        observe("preparation.stage", stage, "idle"),
      ),
    ]);
  }
  async function arrive(expected: string) {
    const actual = await Promise.race([
      nextPause.promise,
      owner!.then(() => {
        throw new Error(
          "Observation completed before expected preparation boundary",
        );
      }),
    ]);
    assert.equal(actual, expected);
    nextPause = deferred<string>();
  }
  store.start();
  try {
    for (const [index, state] of states.entries()) {
      const expected = state.preparation;
      const previous = index ? states[index - 1]!.preparation : expected;
      switch (state.op) {
        case "init":
          break;
        case "request":
          stages = new Set();
          paused = undefined;
          owner = store.refresh();
          break;
        case "reply": {
          owner = owners.get(issued)!;
          const reply = request!;
          request = undefined;
          reply.resolve(response());
          if (expected.stage !== "decode") await completed();
          else await arrive("decode");
          break;
        }
        case "project":
        case "prepareOffice": {
          assert(paused);
          const pause = paused;
          paused = undefined;
          pause.release();
          if (!["object", "admission"].includes(expected.stage))
            await completed();
          else await arrive(state.op === "project" ? "object" : "office");
          break;
        }
        case "admit": {
          assert(paused?.stage === "office");
          const pause = paused;
          paused = undefined;
          pause.release();
          await completed();
          if (issued > previous.issued) witnesses.add("priorityFollowup");
          const actual = store.get();
          if (
            actual.status === "ready" &&
            !actual.connections[0]?.actionable &&
            actual.connections[1]?.actionable
          )
            witnesses.add("siblingSurvives");
          break;
        }
        case "failure": {
          owner = owners.get(issued)!;
          const reply = request!;
          request = undefined;
          reply.reject(new Error("Synthetic snapshot failure"));
          await completed();
          if (issued > previous.issued) witnesses.add("priorityFollowup");
          if (store.get().status === "error") witnesses.add("requestFailure");
          break;
        }
        case "disconnect":
          status("disconnected");
          if (["decode", "object", "admission"].includes(previous.stage)) {
            observe(
              "preparation.interruption.status",
              store.get().status,
              "error",
            );
            witnesses.add(`${previous.stage}Interrupted`);
          }
          break;
        case "priority":
          store.setSelectedConnectionId(ids[state.target]!);
          break;
        case "retire":
          live[state.target] = false;
          break;
        default:
          throw new Error("Unknown observation preparation action");
      }
      const actual = store.get();
      observe("preparation.status", actual.status, expected.status);
      observe("preparation.revision", actual.revision, expected.revision);
      observe("preparation.issued", issued, expected.issued);
      observe("preparation.hint", capturedHint, expected.requested);
      observe(
        "preparation.catalogue",
        actual.connections.length,
        expected.catalogue ? 2 : 0,
      );
      for (const [h, connection] of actual.connections.entries()) {
        observe("preparation.owner", connection.connectionId, ids[h]);
        observe("preparation.generation", connection.generation, 1);
        observe(
          "preparation.actionable",
          connection.actionable,
          expected.actionable[h],
        );
        observe("preparation.stale", connection.stale, !expected.actionable[h]);
      }
    }
  } finally {
    retiring = true;
    store.stop();
    request?.resolve(response());
    paused?.release();
    await Promise.all(owners.values());
  }
  return witnesses;
}
