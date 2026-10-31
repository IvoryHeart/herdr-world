import assert from "node:assert/strict";
import { WorldObservation } from "../server/src/world/observation-v1";
import type { WorldSnapshotResult } from "../server/src/world/snapshot";
import { WorldRuntimeStore } from "../web/src/world/runtimeStore";
import type {
  BridgeControlMsg,
  BridgeHello,
  ConnectionStatus,
} from "../web/src/api";
import type { TraceState } from "./replay";
import { observe } from "./observations";
import { syntheticBridge } from "./bridge-fixture";

export type BaseState = {
  inc: number;
  gen: number[];
  token: number[];
  epoch: number;
  heldInc: number;
  heldGen: number[];
  heldToken: number[];
  live: boolean[];
  actionable: boolean[];
  phase: string;
  issued: number;
  captured: number;
  baseInc: number;
  baseGen: number[];
  baseToken: number[];
  replyInc: number;
  replyGen: number[];
  replyToken: number[];
  confirms: boolean[];
  fresh: boolean;
  validConfirmation: boolean;
};
const ids = ["synthetic-a", "synthetic-b"];
export function baseSnapshot(
  s: Pick<BaseState, "gen" | "token">,
): WorldSnapshotResult {
  const empty = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
  return {
    revision: 1,
    observed_at: 1,
    connections: ids.map((id, h) => ({
      connection_id: id,
      label: id,
      source: "synthetic",
      is_default: h === 0,
      state: "ready",
      generation: s.gen[h]!,
      snapshot_generation: s.gen[h]!,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [
          { workspace_id: "room", number: 0, label: `token-${s.token[h]}` },
        ],
        tabs: [],
        panes: [],
        agents: [],
        coverage: {
          workspaces: 1,
          tabs: 0,
          panes: 0,
          agent_panes: 0,
          status: empty,
          by_workspace: [
            {
              workspace_id: "room",
              tabs: 0,
              panes: 0,
              agent_panes: 0,
              status: empty,
            },
          ],
        },
        watch_admission: {
          revision: 0,
          registered: 0,
          missing: 0,
          unresolved: 0,
          matched: 0,
          admitted: 0,
          admission_failed: 0,
        },
      },
    })),
  };
}

/** Exhaust the service rule, including independently forged generation/token pairs. */
export function checkServiceRule(Observation = WorldObservation) {
  for (const generation of [1, 2]) {
    const observation = new Observation("inc-0");
    const snapshot = baseSnapshot({
      gen: [generation, generation],
      token: [0, 0],
    });
    const token = observation.reply(snapshot).connections[0]!.token!;
    for (const inc of ["inc-0", "inc-1"])
      for (const baseGeneration of [1, 2])
        for (const baseToken of [token, "unknown"]) {
          const host = observation.reply(snapshot, {
            service_incarnation: inc,
            hosts: [
              {
                connection_id: ids[0]!,
                generation: baseGeneration,
                token: baseToken,
              },
            ],
          }).connections[0]!;
          observe(
            "base.generation",
            host.unchanged === true,
            inc === "inc-0" &&
              baseGeneration === generation &&
              baseToken === token,
          );
        }
  }
}

export async function replayObservationBase(
  states: TraceState[],
  Store = WorldRuntimeStore,
  Observation = WorldObservation,
) {
  checkServiceRule(Observation);
  let state = states[0]!.s as BaseState;
  let qualifier = syntheticBridge();
  let service = new Observation(`inc-${state.inc}`);
  let status!: (status: ConnectionStatus) => void;
  let control!: (control: BridgeControlMsg) => void;
  let params: Record<string, unknown> | undefined;
  let request: ReturnType<typeof Promise.withResolvers<unknown>> | undefined;
  let pending: Promise<void> | undefined;
  let response: ReturnType<WorldObservation["reply"]> | undefined;
  let fallback = false;
  let fallbackCalls = 0;
  let calls = 0;
  let previousInc = -1;
  const admittedContent = new WeakMap<object, number>();
  const witnesses = new Set<string>();
  const hello = (inc: number): BridgeHello => ({
    hello: true,
    bridge_protocol_version: 2,
    default_connection_id: ids[0]!,
    service_incarnation: `inc-${inc}`,
    capabilities: { world_observation_v1: true },
  });
  const client = {
    hello: hello(0),
    call: async (_method: string, value?: Record<string, unknown>) => {
      calls++;
      if (fallback) {
        fallbackCalls++;
        return JSON.parse(JSON.stringify(service.reply(baseSnapshot(state))));
      }
      params = value;
      request = Promise.withResolvers<unknown>();
      return request.promise;
    },
    connection: (id: string, generation: number) =>
      qualifier.bridge.connection(id, generation),
    onStatus: (listener: typeof status) => {
      status = listener;
      return () => {};
    },
    onControl: (listener: typeof control) => {
      control = listener;
      return () => {};
    },
  };
  const store = new Store(client, async () => {}, {
    after: () => () => {},
    every: () => () => {},
  });
  store.start();
  const qualify = () =>
    qualifier.bridge.setConnectionRuntimeGenerations(
      ids.map((id, h) => ({
        id,
        generation: state.gen[h]!,
        state: state.live[h] ? "ready" : "reconnecting",
      })),
    );
  const check = () => {
    const actual = store.get();
    observe("base.requests", calls, state.issued);
    for (let h = 0; h < 2; h++) {
      const host = actual.connections.find(
        (host) => host.connectionId === ids[h],
      );
      observe("base.held", Boolean(host), state.heldGen[h]! > 0);
      if (!host) continue;
      observe("base.generation", host.snapshotGeneration, state.heldGen[h]);
      observe(
        "base.token",
        host.snapshot?.workspaces[0]?.label,
        `token-${state.heldToken[h]}`,
      );
      observe("base.actionable", host.actionable, state.actionable[h]);
      if (host.actionable) {
        observe(
          "base.authority",
          qualifier.bridge.connection(ids[h]!, host.generation).isCurrent(),
          true,
        );
      }
    }
  };
  try {
    qualify();
    for (let i = 1; i < states.length; i++) {
      const before = state;
      state = states[i]!.s as BaseState;
      const h = states[i]!.host as number;
      switch (states[i]!.op) {
        case "change":
          break;
        case "retire":
        case "browserRetire":
          qualify();
          control({
            type: "world_invalidated",
            connection_id: ids[h]!,
            connection_generation: state.gen[h],
            connection_state: state.live[h] ? "ready" : "reconnecting",
          });
          break;
        case "drop":
          store.get().connections = store
            .get()
            .connections.filter((host) => host.connectionId !== ids[h]);
          break;
        case "restart":
          status("disconnected");
          qualifier.restore();
          qualifier = syntheticBridge();
          qualify();
          service = new Observation(`inc-${state.inc}`);
          client.hello = hello(state.inc);
          break;
        case "disconnect":
          status("disconnected");
          break;
        case "request":
          fallbackCalls = 0;
          fallback = false;
          params = undefined;
          pending = store.refresh();
          assert(request);
          break;
        case "reply": {
          response = service.reply(baseSnapshot(state), params?.base as any);
          for (let owner = 0; owner < 2; owner++)
            observe(
              "base.generation",
              response.connections[owner]!.unchanged === true,
              state.confirms[owner],
            );
          break;
        }
        case "apply": {
          assert(request && pending && response);
          fallback = true;
          request.resolve(JSON.parse(JSON.stringify(response)));
          await pending;
          request = undefined;
          pending = undefined;
          response = undefined;
          if (before.captured === before.epoch) {
            const actual = store.get();
            observe(
              "base.incarnation",
              actual.serviceIncarnation,
              `inc-${state.heldInc}`,
            );
            for (const host of actual.connections)
              if (host.snapshot) {
                const origin = admittedContent.get(host.snapshot);
                if (origin !== undefined)
                  observe("base.incarnation", origin, state.heldInc);
                admittedContent.set(host.snapshot, state.heldInc);
              }
            if (before.confirms.every(Boolean) && !fallbackCalls)
              witnesses.add("unchangedSkip");
            if (before.confirms[0] !== before.confirms[1])
              witnesses.add("oneHostReplaced");
            if (state.heldInc !== previousInc && previousInc >= 0)
              witnesses.add("incarnationChanged");
            if (
              before.confirms.some(
                (confirmed, h) => confirmed && !state.live[h],
              )
            )
              witnesses.add("retiredDuringRequest");
            if (fallbackCalls > 0) witnesses.add("discardedConfirmation");
            previousInc = state.heldInc;
          }
          break;
        }
      }
      check();
    }
    return witnesses;
  } finally {
    store.stop();
    request?.resolve({});
    await pending;
    qualifier.restore();
  }
}
