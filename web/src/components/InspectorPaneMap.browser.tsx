import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { __storeTesting, store } from "../store";
import type { Pane, Workspace } from "../types";
import { InspectorPaneMap } from "./InspectorPaneMap";
import "../styles/tokens.css";
import "../styles/base.css";

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};
const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 20)),
  );

const workspace: Workspace = {
  workspace_id: "w1",
  number: 1,
  label: "Project",
  focused: true,
  pane_count: 4,
  tab_count: 2,
  agent_status: "idle",
  active_tab_id: "w1:t1",
};
// A review round: the author on the left, two reviewers stacked on the right.
const agents = [
  ["w1:p1", "author", "working"],
  ["w1:p2", "reviewer-a", "blocked"],
  ["w1:p3", "reviewer-b", "done"],
] as const;
const panes: Pane[] = [
  ...agents.map(([pane_id, agent_name, agent_status], index) => ({
    pane_id,
    terminal_id: `terminal-${index + 1}`,
    workspace_id: "w1",
    tab_id: "w1:t1",
    cwd: "/repo",
    focused: index === 0,
    agent: "claude",
    agent_name,
    agent_status,
    revision: 1,
  })),
  {
    pane_id: "w1:p4",
    terminal_id: "terminal-4",
    workspace_id: "w1",
    tab_id: "w1:t2",
    cwd: "/repo",
    focused: true,
    agent: "codex",
    agent_status: "idle",
    revision: 1,
  },
];
__storeTesting.replaceState({
  ...store.get(),
  status: "connected",
  catalogueReady: true,
  activeConnectionId: "local",
  connectionGeneration: 1,
  serverRuntimeGeneration: 1,
  lastRefresh: 1,
  workspaces: [workspace],
  tabs: ["w1:t1", "w1:t2"].map((tab_id, index) => ({
    tab_id,
    workspace_id: "w1",
    number: index + 1,
    label: index ? "Solo" : "Review round",
    focused: index === 0,
    pane_count: index ? 1 : 3,
    agent_status: "idle",
  })),
  panes,
  // As Herdr reports a tab no client shows: 10×1 cells, one pane 0 tall.
  layout: {
    workspace_id: "w1",
    tab_id: "w1:t1",
    zoomed: false,
    area: rect(0, 0, 10, 1),
    focused_pane_id: "w1:p1",
    splits: [
      {
        id: "split_0_root",
        direction: "right",
        rect: rect(0, 0, 10, 1),
        ratio: 0.5,
      },
      {
        id: "split_1_1",
        direction: "down",
        rect: rect(5, 0, 5, 1),
        ratio: 0.5,
      },
    ],
    panes: [
      { pane_id: "w1:p1", focused: true, rect: rect(0, 0, 5, 1) },
      { pane_id: "w1:p2", focused: false, rect: rect(5, 0, 5, 1) },
      { pane_id: "w1:p3", focused: false, rect: rect(5, 1, 5, 0) },
    ],
  },
});

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

const selections: string[] = [];
function Fixture({ tabId }: { tabId: string }) {
  const [selected, setSelected] = useState(
    tabId === "w1:t1" ? "w1:p1" : "w1:p4",
  );
  return (
    <InspectorPaneMap
      workspaceId="w1"
      tabId={tabId}
      tabLabel="Review round"
      tabPanes={panes.filter((pane) => pane.tab_id === tabId)}
      workspace={workspace}
      selectedPaneId={selected}
      onSelect={(paneId) => {
        selections.push(paneId);
        setSelected(paneId);
      }}
    />
  );
}

async function run() {
  const multi = document.createElement("header");
  const single = document.createElement("header");
  document.body.append(multi, single);
  flushSync(() => {
    createRoot(multi).render(<Fixture tabId="w1:t1" />);
    createRoot(single).render(<Fixture tabId="w1:t2" />);
  });
  await settle();

  check(single.childElementCount === 0, "a single-pane tab shows a glyph");
  const glyph = multi.querySelector<HTMLButtonElement>(
    ".inspector-pane-map-glyph",
  );
  check(!!glyph, "a multi-pane tab shows no glyph");
  if (!glyph) return;
  const cells = [...glyph.querySelectorAll<HTMLElement>("i")];
  check(cells.length === 3, `glyph draws ${cells.length} panes, not 3`);
  check(
    cells[0]?.style.height === "100%" &&
      cells[0]?.style.width === "50%" &&
      cells[2]?.style.top === "50%" &&
      cells[2]?.style.left === "50%",
    "glyph does not draw Herdr's real split",
  );
  check(
    cells[0]?.classList.contains("is-selected") === true &&
      cells[1]?.dataset.tone === "blocked",
    "glyph does not light the shown pane and the one that needs you",
  );
  check(
    glyph.getAttribute("aria-label") ===
      "Panes in this tab: 3, showing author-claude",
    `glyph label: ${glyph.getAttribute("aria-label")}`,
  );

  glyph.click();
  await settle();
  const map = () =>
    document.querySelector<HTMLElement>('[aria-label="Panes in this tab"]');
  check(!!map(), "one tap does not open the map");
  const buttons = [
    ...(map()?.querySelectorAll<HTMLButtonElement>(
      ".inspector-pane-map-cell",
    ) ?? []),
  ];
  check(
    buttons.map((button) => button.getAttribute("aria-label")).join("|") ===
      "author-claude, working|reviewer-a-claude, blocked|reviewer-b-claude, done",
    `map cells: ${buttons.map((button) => button.getAttribute("aria-label"))}`,
  );
  check(
    buttons[0]?.getAttribute("aria-pressed") === "true" &&
      buttons[2]?.getAttribute("aria-pressed") === "false",
    "map does not mark the shown pane",
  );
  const bounds = buttons.map((button) => button.getBoundingClientRect());
  check(
    bounds.length === 3 &&
      bounds[1]!.left >= bounds[0]!.right - 1 &&
      bounds[2]!.top >= bounds[1]!.bottom - 1 &&
      Math.abs(bounds[1]!.left - bounds[2]!.left) < 1,
    "map cells are not laid out as the split",
  );

  buttons[2]?.click();
  await settle();
  check(
    selections.join(",") === "w1:p3",
    `tapping a pane selected ${selections.join(",") || "nothing"}`,
  );
  check(!map(), "the map stays open after switching");
  check(
    glyph.querySelectorAll("i")[2]?.classList.contains("is-selected") === true,
    "glyph does not follow the new selection",
  );

  glyph.click();
  await settle();
  map()
    ?.querySelector<HTMLButtonElement>('[data-map-pane-id="w1:p3"]')
    ?.click();
  await settle();
  check(
    selections.length === 1 && !map(),
    "tapping the shown pane switched again or left the map open",
  );

  glyph.click();
  await settle();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle();
  check(!map(), "Escape does not close the map");
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    }),
  );
