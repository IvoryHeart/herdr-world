import { useEffect, useState } from "react";
import type { Tab, Workspace } from "../types";

type TestSnapshot = {
  activeConnectionId: string;
  serverRuntimeGeneration: number;
  workspaces: Workspace[];
  tabs: Tab[];
};

const workspace = (
  id: string,
  focused: boolean,
  activeTabId: string,
): Workspace => ({
  workspace_id: id,
  number: 1,
  label: id,
  focused,
  pane_count: 2,
  tab_count: 2,
  active_tab_id: activeTabId,
  agent_status: "idle",
});
const tab = (id: string, focused: boolean): Tab => ({
  tab_id: id,
  workspace_id: "alpha",
  number: 1,
  label: id === "one" ? "First" : "Second",
  focused,
  pane_count: 1,
  agent_status: "idle",
});

let snapshot: TestSnapshot = {
  activeConnectionId: "connection-a",
  serverRuntimeGeneration: 7,
  workspaces: [workspace("alpha", true, "one")],
  tabs: [tab("one", true), tab("two", false)],
};
let mobile = false;
const storeListeners = new Set<() => void>();
const layoutListeners = new Set<() => void>();
const calls = {
  focusTab: [] as string[],
  closeTab: [] as string[],
  requestCloseTab: [] as string[],
};

export function requestCloseTab(tabId: string) {
  calls.requestCloseTab.push(tabId);
  window.dispatchEvent(
    new CustomEvent("herdr-world:request-close-tab", { detail: { tabId } }),
  );
}

window.__SPACES_TEST_STORE__ = {
  snapshot: () => snapshot,
  set(patch) {
    snapshot = { ...snapshot, ...patch } as TestSnapshot;
    for (const listener of storeListeners) listener();
  },
  calls,
};
window.__SPACES_TEST_LAYOUT__ = {
  setMobile(value) {
    mobile = value;
    for (const listener of layoutListeners) listener();
  },
};

export const store = {
  focusTab(tabId: string) {
    calls.focusTab.push(tabId);
    snapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map((current) => ({
        ...current,
        focused: current.tab_id === tabId,
      })),
      workspaces: snapshot.workspaces.map((current) =>
        current.workspace_id ===
        snapshot.tabs.find((candidate) => candidate.tab_id === tabId)
          ?.workspace_id
          ? { ...current, active_tab_id: tabId }
          : current,
      ),
    };
    for (const listener of storeListeners) listener();
    return Promise.resolve();
  },
  closeTab(tabId: string) {
    calls.closeTab.push(tabId);
    snapshot = {
      ...snapshot,
      tabs: snapshot.tabs.filter((tab) => tab.tab_id !== tabId),
    };
    for (const listener of storeListeners) listener();
    return Promise.resolve();
  },
};

export function useStoreSelector<T>(selector: (state: TestSnapshot) => T): T {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const notify = () => setRevision((current) => current + 1);
    storeListeners.add(notify);
    return () => {
      storeListeners.delete(notify);
    };
  }, []);
  return selector(snapshot);
}

export function useLayoutPreferences() {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const notify = () => setRevision((current) => current + 1);
    layoutListeners.add(notify);
    return () => {
      layoutListeners.delete(notify);
    };
  }, []);
  return { mobile };
}

export function shallowEqual(left: unknown, right: unknown) {
  return Object.is(left, right);
}
