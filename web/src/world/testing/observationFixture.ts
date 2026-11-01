import { WorldObservation } from "../../../../server/src/world/observation-v1";
import type { WorldSnapshotResult } from "../../../../server/src/world/snapshot";
import type {
  BridgeControlMsg,
  BridgeHello,
  ConnectionStatus,
} from "../../api";
import { WorldRuntimeStore } from "../runtimeStore";
import { installTestClock, type ClockTarget } from "./testClock";

export function observationFixture(rooms = 10) {
  const status = () => ({
    working: 1,
    idle: 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  });
  const raw: WorldSnapshotResult = {
    revision: 1,
    observed_at: 1000,
    connections: ["alpha", "beta"].map((id) => ({
      connection_id: id,
      label: id,
      source: "saved-profile",
      is_default: id === "alpha",
      state: "ready",
      generation: 1,
      snapshot_generation: 1,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: Array.from({ length: rooms }, (_, i) => ({
          workspace_id: `w-${i}`,
          number: i,
          label: `Room ${i}`,
          focused: i === 0,
          pane_count: 1,
          tab_count: 1,
          agent_status: "working",
        })),
        tabs: Array.from({ length: rooms }, (_, i) => ({
          tab_id: `t-${i}`,
          workspace_id: `w-${i}`,
          label: `Desk ${i}`,
          number: i,
          pane_count: 1,
          focused: i === 0,
        })),
        panes: Array.from({ length: rooms }, (_, i) => ({
          pane_id: `p-${i}`,
          terminal_id: `term-${i}`,
          workspace_id: `w-${i}`,
          tab_id: `t-${i}`,
          agent: "codex",
          agent_status: "working",
          focused: false,
        })),
        agents: [],
        coverage: {
          workspaces: rooms,
          tabs: rooms,
          panes: rooms,
          agent_panes: rooms,
          status: { ...status(), working: rooms },
          by_workspace: Array.from({ length: rooms }, (_, i) => ({
            workspace_id: `w-${i}`,
            tabs: 1,
            panes: 1,
            agent_panes: 1,
            status: status(),
          })),
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
  let service = new WorldObservation("synthetic-service");
  const calls: Record<string, unknown>[] = [];
  let control: (value: BridgeControlMsg) => void = () => {};
  let onStatus: (value: ConnectionStatus) => void = () => {};
  const live = new Map([
    ["alpha", true],
    ["beta", true],
  ]);
  const timers = {} as ClockTarget;
  const clock = installTestClock(timers, { now: () => 0 });
  const client = {
    hello: {
      hello: true,
      bridge_protocol_version: 2,
      default_connection_id: "alpha",
      service_incarnation: service.incarnation,
      capabilities: { world_observation_v1: true },
    } as BridgeHello,
    call: async (
      _method: string,
      params: Record<string, unknown> = {},
    ): Promise<unknown> => {
      calls.push(params);
      return JSON.parse(
        JSON.stringify(service.reply(structuredClone(raw), params.base as any)),
      );
    },
    connection: (id: string, generation: number) => ({
      isCurrent: () =>
        live.get(id) === true &&
        raw.connections.find((host) => host.connection_id === id)
          ?.generation === generation,
    }),
    onControl: (callback: typeof control) => {
      control = callback;
      return () => {};
    },
    onStatus: (callback: typeof onStatus) => {
      onStatus = callback;
      return () => {};
    },
  };
  const store = new WorldRuntimeStore(client, () => clock.advance(16), {
    after(callback, ms) {
      const timer = timers.setTimeout(callback, ms);
      return () => timers.clearTimeout(timer);
    },
    every(callback, ms) {
      const timer = timers.setInterval(callback, ms);
      return () => timers.clearInterval(timer);
    },
  });
  return {
    raw,
    client,
    store,
    calls,
    live,
    clock,
    control: (value: BridgeControlMsg) => control(value),
    status: (value: ConnectionStatus) => onStatus(value),
    restart: () => {
      service = new WorldObservation("replacement-service");
      client.hello = {
        ...client.hello,
        service_incarnation: service.incarnation,
      };
    },
  };
}
