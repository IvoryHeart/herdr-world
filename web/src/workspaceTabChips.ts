import { agentAttentionPriority } from "./agentOrder";
import {
  type AgentStateKind,
  agentStateKind,
  paneHasAgentHistory,
} from "./components/agentSession";
import type { Pane, Tab } from "./types";

/** Tabs shown as numbered chips in a workspace row. */
export const MAX_WORKSPACE_TAB_CHIPS = 6;

export type WorkspaceTabChip = {
  tabId: string;
  number: number;
  label: string;
  focused: boolean;
  /** Most urgent agent state in the tab, in attention order. */
  status: AgentStateKind;
  /** Pane to open for this tab: its focused pane, else its first pane. */
  paneId?: string;
};

export function workspaceTabChips(
  tabs: readonly Tab[],
  panes: readonly Pick<
    Pane,
    "pane_id" | "tab_id" | "focused" | "agent" | "agent_status"
  >[],
): Map<string, WorkspaceTabChip[]> {
  const panesByTab = new Map<string, typeof panes>();
  for (const pane of panes) {
    panesByTab.set(pane.tab_id, [...(panesByTab.get(pane.tab_id) ?? []), pane]);
  }
  const chips = new Map<string, WorkspaceTabChip[]>();
  for (const tab of tabs) {
    const tabPanes = panesByTab.get(tab.tab_id) ?? [];
    let status: AgentStateKind = "unknown";
    for (const pane of tabPanes) {
      if (!paneHasAgentHistory(pane)) continue;
      const candidate = agentStateKind(pane.agent_status);
      if (agentAttentionPriority(candidate) < agentAttentionPriority(status)) {
        status = candidate;
      }
    }
    const chip: WorkspaceTabChip = {
      tabId: tab.tab_id,
      number: tab.number,
      label: tab.label,
      focused: tab.focused,
      status,
      paneId: (tabPanes.find((pane) => pane.focused) ?? tabPanes[0])?.pane_id,
    };
    chips.set(tab.workspace_id, [...(chips.get(tab.workspace_id) ?? []), chip]);
  }
  return chips;
}

// Chip geometry, kept in sync with WorkspaceTree.css.
export const WORKSPACE_TAB_CHIP_WIDTH = 16;
export const WORKSPACE_TAB_CHIP_GAP = 2;
export const WORKSPACE_TAB_CHIP_MORE_WIDTH = 22;

function chipsWidth(count: number): number {
  return (
    count * WORKSPACE_TAB_CHIP_WIDTH +
    Math.max(0, count - 1) * WORKSPACE_TAB_CHIP_GAP
  );
}

/**
 * Chips that fit the available width, plus how many tabs the "+N" marker
 * stands for. Narrow rows fold down to one chip and the marker.
 */
export function visibleWorkspaceTabChips(
  chips: readonly WorkspaceTabChip[],
  availableWidth = Number.POSITIVE_INFINITY,
): {
  visible: WorkspaceTabChip[];
  hidden: number;
} {
  if (
    chips.length <= MAX_WORKSPACE_TAB_CHIPS &&
    chipsWidth(chips.length) <= availableWidth
  ) {
    return { visible: [...chips], hidden: 0 };
  }
  let count = Math.min(MAX_WORKSPACE_TAB_CHIPS - 1, chips.length - 1);
  while (
    count > 1 &&
    chipsWidth(count) + WORKSPACE_TAB_CHIP_GAP + WORKSPACE_TAB_CHIP_MORE_WIDTH >
      availableWidth
  ) {
    count -= 1;
  }
  const visible = chips.slice(0, Math.max(1, count));
  return { visible, hidden: chips.length - visible.length };
}
