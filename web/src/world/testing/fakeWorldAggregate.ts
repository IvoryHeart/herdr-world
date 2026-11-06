import { spyOn } from "bun:test";
import type { ConnectionAgentSessions } from "../../useAllServerAgentSessions";
import { type WorldRuntimeState, worldRuntimeStore } from "../runtimeStore";

const zero = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };

/**
 * Serves connection summaries as World's aggregate observation, the source of
 * the sidebar's All servers scope (World does not poll every connection).
 * `publish()` delivers the current `read()` result to subscribers.
 */
export function fakeWorldAggregate(
  read: () => { sessions: ConnectionAgentSessions[]; error?: string | null },
) {
  const state = (): WorldRuntimeState => {
    const { sessions, error = null } = read();
    return {
      status: error ? "error" : "ready",
      revision: 1,
      observedAt: 0,
      error,
      connections: sessions.map((session) => ({
        connectionId: session.connection_id,
        label: session.connection_id,
        source: "test",
        isDefault: false,
        state: "ready",
        generation: session.connection_generation,
        snapshotGeneration: session.connection_generation,
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: session.workspaces,
          tabs: session.tabs,
          panes: session.panes,
          agents: [],
          coverage: {
            workspaces: session.workspaces.length,
            tabs: session.tabs.length,
            panes: session.panes.length,
            agentPanes: 0,
            status: zero,
            byWorkspace: [],
          },
        },
      })),
    };
  };
  let current = state();
  const listeners = new Set<() => void>();
  const get = spyOn(worldRuntimeStore, "get").mockImplementation(() => current);
  const subscribe = spyOn(worldRuntimeStore, "subscribe").mockImplementation(
    (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  return {
    get,
    subscribe,
    publish() {
      current = state();
      for (const listener of listeners) listener();
    },
  };
}
