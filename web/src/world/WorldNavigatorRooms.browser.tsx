// Spaces lists every runtime's rooms with their tabs, as Town has them
// (#1430): a Herdr TUI room and a herdr-core room, each marked with its
// runtime, its tabs as rows under it and named as Town names its desks. The
// page renders the real navigator from a parsed World observation and checks
// it against Town's projection of the same World, on desktop and phone.
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { WORKSPACE_AGENT_LAYOUT_STORAGE_KEY } from "../workspaceAgentLayout";
import { projectWorldOffice } from "./herdrOfficeProjection";
import { spacesRoomsWorld } from "./spacesRooms.fixture";
import { WorldNavigator } from "./WorldNavigator";
import type { WorldObjectNode } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

const mode = new URLSearchParams(location.search).get("mode");
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
window.addEventListener("error", (event) =>
  failures.push(`Uncaught browser error: ${event.message}`),
);

// A saved "Separate" agent layout must not pull terminals out of rooms.
worldLocalStorage.setItem(WORKSPACE_AGENT_LAYOUT_STORAGE_KEY, "separate");
initializeLayoutPreferences();
const world = spacesRoomsWorld();
const town = projectWorldOffice(world, 0);
const selected: string[] = [];
const select = (node: WorldObjectNode) => {
  selected.push(node.nativeId);
};
const mount = document.createElement("main");
mount.style.width = mode === "phone" ? "100%" : "320px";
document.body.append(mount);
createRoot(mount).render(<WorldNavigator world={world} onSelect={select} />);

const settle = (ms = 0) =>
  new Promise<void>((resolve) =>
    setTimeout(() => requestAnimationFrame(() => resolve()), ms),
  );
const text = (element: Element | null | undefined) =>
  element?.textContent?.trim() ?? "";

/** Each room row of a host's tree with the tab rows that follow it. */
function rooms(connectionId: string) {
  const tree = document.querySelector(
    `[data-world-navigator-host="${connectionId}"] [role="tree"]`,
  );
  const listed: { row: HTMLElement; label: string; tabs: HTMLElement[] }[] = [];
  for (const item of tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ??
    []) {
    const label = item.querySelector("[data-room-label]");
    if (label) listed.push({ row: item, label: text(label), tabs: [] });
    else if (item.classList.contains("workspace-tab-row"))
      listed[listed.length - 1]?.tabs.push(item);
  }
  return listed;
}

async function run() {
  await settle(50);
  const expected = [
    { connectionId: "tui", runtime: "herdr", tag: "Herdr TUI" },
    { connectionId: "core", runtime: "herdr-core", tag: "herdr-core" },
  ];
  const listed = expected.map(({ connectionId }) => rooms(connectionId));
  check(
    JSON.stringify(listed.map((each) => each.length)) === "[1,1]",
    `rooms per runtime: ${JSON.stringify(listed.map((each) => each.map((room) => room.label)))}`,
  );
  check(
    JSON.stringify(listed.map((each) => each[0]?.tabs.length)) === "[2,3]",
    `tabs per room: ${JSON.stringify(listed.map((each) => each[0]?.tabs.map(text)))}`,
  );

  // Cross-view: the same World gives Spaces Town's room and tab names.
  for (const [index, { connectionId, runtime, tag }] of expected.entries()) {
    const room = listed[index]?.[0];
    const host = world.hosts.find((each) => each.connectionId === connectionId);
    const townRoom = town.rooms.find(
      (each) => each.key === host?.spaces[0]?.id,
    );
    check(townRoom, `Town has no room for ${connectionId}`);
    check(
      room?.label === townRoom?.displayLabel,
      `${connectionId} room reads ${room?.label}, Town ${townRoom?.displayLabel}`,
    );
    const tabs = room?.tabs.map(text) ?? [];
    const desks = townRoom?.desks.map((desk) => desk.displayLabel) ?? [];
    check(
      JSON.stringify(tabs) === JSON.stringify(desks),
      `${connectionId} tabs read ${JSON.stringify(tabs)}, Town ${JSON.stringify(desks)}`,
    );
    const mark = room?.row.querySelector<HTMLElement>(
      ".workspace-runtime-mark",
    );
    check(
      mark?.dataset.runtime === runtime &&
        mark.getAttribute("aria-label") === `Runtime: ${tag}` &&
        mark.getBoundingClientRect().width > 0,
      `${connectionId} room's runtime mark: ${mark?.outerHTML}`,
    );
    // Each tab holds its own terminal, right under it.
    for (const tab of room?.tabs ?? []) {
      const next = tab.nextElementSibling;
      check(
        next?.matches(".agent-row[data-pane-id]"),
        `${connectionId} tab ${text(tab)} holds no terminal row`,
      );
    }
  }
  check(
    JSON.stringify(listed.flatMap((each) => each[0]?.tabs.map(text))) ===
      JSON.stringify(["Planner", "Ada", "crew-a", "crew-b", "crew-c"]),
    `tab names: ${JSON.stringify(listed.flatMap((each) => each[0]?.tabs.map(text)))}`,
  );

  // Spaces keeps no layout of its own: no per-runtime heading, no layout
  // switch, no separate agent list.
  check(
    !document.querySelector(".workspace-agent-layout-control"),
    "the navigator offers an agent layout switch",
  );
  check(
    !document.querySelector(".agents-panel"),
    "the navigator lists agents apart from their rooms",
  );
  check(
    ![...document.querySelectorAll(".panel-head h2")].some((heading) =>
      /workspaces/i.test(text(heading)),
    ),
    "the navigator repeats a Workspaces heading per runtime",
  );

  // Choosing a core tab opens its terminal; a TUI agent opens as today.
  listed[1]?.[0]?.tabs[1]?.click();
  document
    .querySelector<HTMLElement>(
      '[data-world-navigator-host="tui"] [data-pane-id="w1:p2"]',
    )
    ?.click();
  await settle();
  check(
    JSON.stringify(selected) === JSON.stringify(["t2", "w1:p2"]),
    `choosing selected ${JSON.stringify(selected)}`,
  );

  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, failures }),
  });
}

void run().catch((error) =>
  fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      failures: [...failures, `run failed: ${String(error?.stack ?? error)}`],
    }),
  }),
);
