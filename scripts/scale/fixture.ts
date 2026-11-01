export type Shape = {
  id: string;
  sources: number;
  workspaces: number;
  tabs: number;
  panes: number;
  agents: number;
  active: number;
  replicated?: boolean;
};

// Count-only historical observation; placement and all content are synthetic.
export const shapes: Shape[] = [
  {
    id: "recorded-current",
    sources: 3,
    workspaces: 15,
    tabs: 66,
    panes: 67,
    agents: 37,
    active: 37,
  },
  {
    id: "active-360",
    sources: 3,
    workspaces: 30,
    tabs: 360,
    panes: 360,
    agents: 360,
    active: 360,
  },
  {
    id: "room-1440",
    sources: 1,
    workspaces: 1,
    tabs: 1440,
    panes: 1440,
    agents: 360,
    active: 360,
  },
  {
    id: "sources-10",
    sources: 10,
    workspaces: 30,
    tabs: 360,
    panes: 360,
    agents: 360,
    active: 360,
  },
  // Same raw shape as createDenseSnapshotFixture; list agents intentionally empty.
  {
    id: "dense-repair",
    sources: 64,
    workspaces: 128896,
    tabs: 128896,
    panes: 2191232,
    agents: 0,
    active: 0,
    replicated: true,
  },
];

export type Row = Record<string, unknown> & {
  workspace_id: string;
  tab_id: string;
  pane_id: string;
};
export type HostData = {
  workspaces: Row[];
  tabs: Row[];
  panes: Row[];
  agents: Row[];
};
const share = (n: number, i: number, count: number) =>
  Math.floor(n / count) + (i < n % count ? 1 : 0);

export function buildShape(shape: Shape): HostData[] {
  const one = (h: number): HostData => {
    const count = (
      key: "workspaces" | "tabs" | "panes" | "agents" | "active",
    ) => share(shape[key], h, shape.sources);
    const workspaces = Array.from({ length: count("workspaces") }, (_, w) => ({
      workspace_id: `w${w}`,
      tab_id: "",
      pane_id: "",
      number: w + 1,
      label: `Synthetic room ${w}`,
      cwd: "/synthetic/project",
      focused: w === 0,
      pane_count: 0,
      tab_count: 0,
      agent_status: "unknown",
    }));
    const tabs = workspaces.flatMap((workspace, w) =>
      Array.from(
        { length: share(count("tabs"), w, workspaces.length) },
        (_, t) => ({
          ...workspace,
          tab_id: `w${w}:t${t}`,
          label: `Synthetic desk ${w}-${t}`,
          number: t + 1,
          focused: t === 0,
        }),
      ),
    );
    let index = 0;
    const panes = tabs.flatMap((tab, t) =>
      Array.from({ length: share(count("panes"), t, tabs.length) }, (_, p) => {
        const i = index++;
        return {
          ...tab,
          pane_id: `${tab.tab_id}:p${p}`,
          terminal_id: `${tab.tab_id}:p${p}`,
          title: `Synthetic terminal ${i}`,
          revision: 1,
          focused: p === 0,
          agent_status: "unknown",
          ...(i < count("agents") || shape.replicated
            ? {
                agent: "codex",
                agent_status: i < count("active") ? "working" : "idle",
                agent_session: {
                  kind: "id",
                  value: `synthetic-session-${i}`,
                  agent: "codex",
                  source: "herdr:codex",
                },
              }
            : {}),
        };
      }),
    );
    const agents = panes.slice(0, count("agents")).map((p, i) => ({
      ...p,
      status: i < count("active") ? "working" : "idle",
      state_change_seq: 1,
      agent_session: {
        kind: "id",
        value: `synthetic-session-${i}`,
        agent: "codex",
        source: "herdr:codex",
      },
    }));
    const byWorkspace = new Map(workspaces.map((w) => [w.workspace_id, w])),
      byTab = new Map(tabs.map((t) => [t.tab_id, t]));
    for (const tab of tabs) byWorkspace.get(tab.workspace_id)!.tab_count++;
    for (const pane of panes) {
      const workspace = byWorkspace.get(pane.workspace_id)!,
        tab = byTab.get(pane.tab_id)!;
      workspace.pane_count++;
      tab.pane_count++;
      if (
        pane.agent_status === "working" ||
        workspace.agent_status === "unknown"
      )
        workspace.agent_status = pane.agent_status;
      if (pane.agent_status === "working" || tab.agent_status === "unknown")
        tab.agent_status = pane.agent_status;
    }
    return { workspaces, tabs, panes, agents };
  };
  // Immutable raw dense lists share parent memory like the maintained repair fixture.
  // Workspace labels alone are mutable, and belong independently to each endpoint.
  if (shape.replicated) {
    const data = one(0);
    return Array.from({ length: shape.sources }, () => ({
      ...data,
      workspaces: data.workspaces.map((w) => ({ ...w })),
    }));
  }
  return Array.from({ length: shape.sources }, (_, h) => one(h));
}
