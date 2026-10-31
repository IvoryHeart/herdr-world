import type { WorldRuntimeConnection } from "../../runtimeStore";

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
