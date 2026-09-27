import { createRoot } from "react-dom/client";
import { __storeTesting, store } from "../store";
import type { Tab, Workspace } from "../types";
import { MobileTabSheet } from "./MobileTabSheet";

const workspace: Workspace = {
  workspace_id: "studio",
  number: 1,
  label: "Studio",
  focused: true,
  pane_count: 0,
  tab_count: 1,
  active_tab_id: "one",
  agent_status: "idle",
};
const tab: Tab = {
  tab_id: "one",
  workspace_id: "studio",
  number: 1,
  label: "One",
  focused: true,
  pane_count: 0,
  agent_status: "idle",
};
__storeTesting.replaceState({
  ...store.get(),
  workspaces: [workspace],
  tabs: [tab],
  panes: [],
});

const events: string[] = [];
const host = document.createElement("main");
document.body.append(host);
createRoot(host).render(
  <MobileTabSheet
    open
    onClose={() => events.push("close")}
    onShowSession={() => events.push("show")}
    onSelectTab={(id) => {
      events.push(`resume:${id}`);
      events.push(`focus:${id}`);
      return Promise.resolve();
    }}
  />,
);

setTimeout(() => {
  const button = document.querySelector<HTMLButtonElement>(
    ".mobile-tab-sheet-focus",
  );
  button?.click();
  setTimeout(() => {
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ button: Boolean(button), events }),
    });
  }, 50);
}, 50);
