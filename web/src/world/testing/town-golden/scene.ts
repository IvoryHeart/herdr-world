import type {
  UsageContext,
  WorldUsageSnapshot,
} from "../../../../../shared/usage";
import type { WorldRuntimeConnection } from "../../runtimeStore";
import { usageFixture } from "../usageFixture";

/** Bounded synthetic topology: two hosts, four rooms, mixed agents and shells. */
export function goldenConnections(): WorldRuntimeConnection[] {
  return ["atlas", "nova"].map((label, host) => {
    const rooms = host ? ["meadow", "lantern"] : ["orbit", "harbor"];
    const workspaces = rooms.map((room, i) => ({
      workspace_id: `host-${host}-room-${i}`,
      number: i + 1,
      label: room,
      focused: i === 0,
      pane_count: 8,
      tab_count: 4,
      active_tab_id: `host-${host}-room-${i}-tab-0`,
      agent_status: "working",
    }));
    const tabs = workspaces.flatMap((room) =>
      Array.from({ length: 4 }, (_, i) => ({
        tab_id: `${room.workspace_id}-tab-${i}`,
        workspace_id: room.workspace_id,
        number: i + 1,
        label: ["build", "review", "notes", "shell"][i]!,
        focused: i === 0,
        pane_count: 2,
        agent_status: "working",
      })),
    );
    const panes = tabs.flatMap((tab, i) =>
      Array.from({ length: 2 }, (_, seat) => ({
        pane_id: `${tab.tab_id}-pane-${seat}`,
        terminal_id: `${tab.tab_id}-terminal-${seat}`,
        workspace_id: tab.workspace_id,
        tab_id: tab.tab_id,
        focused: seat === 0,
        agent: seat ? "" : ["claude", "codex", "pi"][i % 3]!,
        agent_status: seat
          ? ""
          : ["working", "blocked", "done", "idle"][i % 4]!,
        task_summary: seat ? undefined : "Synthetic delivery",
        revision: 1,
      })),
    );
    return {
      connectionId: `host-${host}`,
      label,
      source: "saved-profile",
      isDefault: host === 0,
      state: "ready",
      generation: 1,
      snapshotGeneration: 1,
      stale: false,
      actionable: true,
      snapshot: { workspaces, tabs, panes, agents: [] },
    };
  });
}

/**
 * Context readings for the golden town: two agents at 90% and 95% look tired
 * at their desks (agentContextFill.ts); one at 41% and one on a model with no
 * known window show nothing at the desk. The rest have no reading.
 */
export function goldenUsage(): WorldUsageSnapshot {
  const snapshot = usageFixture({ rows: [], sources: [], window: "7d" });
  const reading = (
    host: number,
    room: number,
    tab: number,
    harness: string,
    model: string,
    used: number,
    window: number | null,
  ): UsageContext => ({
    connection_id: `host-${host}`,
    connection_generation: 1,
    workspace_id: `host-${host}-room-${room}`,
    tab_id: `host-${host}-room-${room}-tab-${tab}`,
    pane_id: `host-${host}-room-${room}-tab-${tab}-pane-0`,
    harness,
    model,
    used_tokens: used,
    window_tokens: window,
    observed_at: snapshot.observed_at,
  });
  return {
    ...snapshot,
    // The shared seven-day read supplies today to the context and economy boards.
    today: {
      total: snapshot.total,
      unattributed: snapshot.unattributed,
      rollups: snapshot.rollups,
    },
    contexts: [
      reading(0, 0, 0, "claude", "claude-opus-4-5", 180_000, 200_000),
      reading(0, 0, 1, "codex", "example-codex", 106_000, 258_400),
      reading(1, 1, 0, "codex", "example-codex", 245_000, 258_400),
      reading(1, 1, 1, "pi", "example-unknown", 150_000, null),
    ],
  };
}
