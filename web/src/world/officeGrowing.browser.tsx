import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Pane, Tab, Workspace } from "../types";
import { buildWorldObject } from "./worldObject";
import { projectWorldOffice } from "./herdrOfficeProjection";
import { deskAnchor } from "./officeGeometry";
import PixelOfficeView from "./PixelOfficeView";
import "./world.css";

export function mountGrowingOffice(
  options: { roomCount?: number; firstRoomTabs?: number } = {},
) {
  const connections = ["Atlas", "Boreal", "Cedar"].map((label, hostIndex) => {
    const workspaces: Workspace[] = [];
    const tabs: Tab[] = [];
    const panes: Pane[] = [];
    const count = hostIndex === 0 ? (options.roomCount ?? 129) : 1;
    for (let index = 0; index < count; index++) {
      const id = `workspace-${index}`;
      const tabCount =
        hostIndex === 0 && index === 0 ? (options.firstRoomTabs ?? 100) : 1;
      workspaces.push({
        workspace_id: id,
        number: index + 1,
        label: `Room ${index + 1}`,
        focused: index === 0,
        pane_count: tabCount,
        tab_count: tabCount,
        agent_status: "working",
      });
      for (let tabIndex = 0; tabIndex < tabCount; tabIndex++) {
        const tabId = `${id}-tab-${tabIndex}`;
        tabs.push({
          tab_id: tabId,
          workspace_id: id,
          number: tabIndex + 1,
          label: `Tab ${tabIndex + 1}`,
          focused: tabIndex === 0,
          pane_count: 1,
          agent_status: "working",
        });
        panes.push({
          pane_id: `pane-${tabId}`,
          terminal_id: `terminal-${tabId}`,
          workspace_id: id,
          tab_id: tabId,
          agent: `Agent ${tabIndex + 1}`,
          agent_status:
            hostIndex === 0 ? "working" : hostIndex === 1 ? "blocked" : "idle",
          focused: tabIndex === 0,
          revision: 1,
        });
      }
    }
    return {
      connectionId: `synthetic-${hostIndex}`,
      label,
      source: "saved-profile" as const,
      isDefault: hostIndex === 0,
      state: "ready" as const,
      generation: 7,
      snapshotGeneration: 7,
      stale: false,
      actionable: true,
      snapshot: { workspaces, tabs, panes, agents: [] },
    };
  });
  const world = buildWorldObject(connections);
  const projection = projectWorldOffice(world, 1);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText =
    "width:100vw;height:820px;position:relative;display:flex;flex-direction:column";
  const root = createRoot(host);
  const activated: string[] = [];
  let selected: string | null = null;
  let publish: (next: typeof world) => void = () => undefined;
  function Harness() {
    const [currentWorld, setWorld] = useState(world);
    publish = setWorld;
    const [selection, setSelection] = useState<string | null>(null);
    return (
      <PixelOfficeView
        world={currentWorld}
        selectedId={selection}
        onSelect={(id) => {
          selected = id;
          setSelection(id);
        }}
        onOpenTerminal={async (id) => {
          activated.push(id);
          setSelection(id);
        }}
        floatingTerminals={[]}
      />
    );
  }
  root.render(<Harness />);
  return {
    host,
    root,
    world,
    projection,
    activated,
    selected: () => selected,
    addTabs() {
      const source = connections[0]!;
      const snapshot = source.snapshot;
      const additions = Array.from({ length: 4 }, (_, index) => ({
        tab_id: `workspace-0-added-${index}`,
        workspace_id: "workspace-0",
        number: 101 + index,
        label: `Added ${index}`,
        focused: false,
        pane_count: 1,
        agent_status: "working",
      }));
      const next = {
        ...source,
        snapshot: {
          ...snapshot,
          workspaces: snapshot.workspaces.map((workspace, index) =>
            index === 0
              ? {
                  ...workspace,
                  tab_count: workspace.tab_count + 4,
                  pane_count: workspace.pane_count + 4,
                }
              : workspace,
          ),
          tabs: [...snapshot.tabs, ...additions],
          panes: [
            ...snapshot.panes,
            ...additions.map((tab) => ({
              pane_id: `pane-${tab.tab_id}`,
              terminal_id: `terminal-${tab.tab_id}`,
              workspace_id: "workspace-0",
              tab_id: tab.tab_id,
              revision: 1,
              agent: "Added agent",
              agent_status: "working",
              focused: false,
            })),
          ],
        },
      };
      publish(buildWorldObject([next, ...connections.slice(1)]));
    },
    dispose() {
      root.unmount();
      host.remove();
    },
  };
}

export async function verifyGrowingOffice(
  check: (condition: boolean, message: string) => void,
  options: { packingOnly?: boolean } = {},
) {
  const fixture = mountGrowingOffice(
    options.packingOnly ? { roomCount: 40 } : {},
  );
  const wait = async (condition: () => boolean, message: string) => {
    for (let index = 0; index < 200; index++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  try {
    await wait(() => {
      const renderer = window.__HERDR_WORLD_RENDERER__;
      const scroller = fixture.host.querySelector<HTMLElement>(
        ".world-stage-scroll",
      );
      const published = renderer?.publishedLayout;
      return (
        renderer?.ready === true &&
        published?.rooms.length === fixture.projection.rooms.length &&
        Boolean(scroller) &&
        published.normalizedInput.availableViewportWidth ===
          scroller!.clientWidth &&
        published.normalizedInput.availableViewportHeight ===
          scroller!.clientHeight
      );
    }, "Growing Office did not publish complete rooms in its settled viewport");
    const diagnostics = () => window.__HERDR_WORLD_RENDERER__!;
    const layout = () => diagnostics().publishedLayout!;
    const scroll = fixture.host.querySelector<HTMLElement>(
      ".world-stage-scroll",
    )!;
    const firstRoom = fixture.projection.rooms[0]!;
    if (innerWidth <= 720) {
      check(
        layout().compact === true &&
          scroll.scrollWidth <= scroll.clientWidth + 1,
        "Growing phone Office overflows horizontally",
      );
      check(
        layout().ceoRect.width === 0,
        "Growing phone Office retained decorative CEO geometry",
      );
      const receptions = layout().ceoBlocks.receptions;
      check(
        receptions.length === 3 &&
          receptions[1]!.width > 0 &&
          receptions[0]!.width === 0 &&
          receptions[2]!.width === 0,
        "Phone did not prioritize the qualified reception needing attention",
      );
      check(
        layout().expenseRect!.y > receptions[1]!.y + receptions[1]!.height &&
          layout().workforceRect!.y >
            layout().expenseRect!.y + layout().expenseRect!.height &&
          layout().rooms[0]!.y >
            layout().workforceRect!.y + layout().workforceRect!.height,
        "Phone sections are not attention receptions, Economy, Workforce, workspace rooms",
      );
      check(
        scroll.scrollTop === 0,
        "Phone Office skipped its initial reception overview",
      );
    }
    if (innerWidth > 720) {
      const large = layout().rooms[0]!;
      check(
        large.deskColumns > (innerWidth >= 1440 ? 4 : 1),
        "Desktop large room retained its four-column restriction",
      );
      check(
        layout()
          .rooms.slice(1)
          .some(
            (room) =>
              room.y > large.y &&
              room.y < large.y + large.height &&
              room.x >= large.x + large.width,
          ),
        "Small desktop rooms did not fill space beside the large room",
      );
    }
    const lastDesk = firstRoom.desks[99]!;
    const target = lastDesk.paneDevices[0]!;
    const point = deskAnchor(layout().rooms[0]!, 99);
    scroll.scrollTo({ top: point.nameY - 200, left: 0, behavior: "instant" });
    const targetButton = () =>
      [
        ...fixture.host.querySelectorAll<HTMLButtonElement>(
          ".world-semantic-target",
        ),
      ].find((button) => button.dataset.targetKey === target.key);
    await wait(
      () =>
        diagnostics().ready &&
        Boolean(targetButton()) &&
        !targetButton()!.closest("[inert]"),
      "Hundredth desk was not admitted in its viewport",
    );
    check(
      fixture.host.querySelectorAll(".world-semantic-target").length <
        50 +
          (Math.ceil(scroll.clientWidth / 220) + 1) *
            (Math.ceil((3 * scroll.clientHeight) / 188) + 1) *
            9,
      "Office semantic admission exceeded its viewport-area budget",
    );
    targetButton()!.focus();
    targetButton()!.click();
    await wait(
      () =>
        fixture.activated.includes(target.nodeId) &&
        diagnostics().ready &&
        [
          ...fixture.host.querySelectorAll<HTMLButtonElement>(
            '.world-semantic-target[aria-pressed="true"]',
          ),
        ].some(
          (button) =>
            button.dataset.targetKey === target.key ||
            button.dataset.targetKey === target.nodeId,
        ),
      "Hundredth pane opened the wrong qualified terminal",
    );
    check(
      fixture.activated[fixture.activated.length - 1] === target.nodeId &&
        target.paneRef.connectionId === "synthetic-0",
      "Colliding synthetic host identifiers redirected activation",
    );
    if (options.packingOnly) {
      scroll.scrollTo({ top: layout().rooms[0]!.y, behavior: "instant" });
      const collapse = () =>
        [
          ...fixture.host.querySelectorAll<HTMLButtonElement>(
            "button[data-room-key]",
          ),
        ].find(
          (button) =>
            button.dataset.roomKey === firstRoom.key &&
            button.getAttribute("aria-expanded") === "true",
        );
      await wait(
        () =>
          diagnostics().ready && Boolean(collapse()) && !collapse()!.disabled,
        "Wide room collapse action was not reachable",
      );
      collapse()!.click();
      await wait(
        () => diagnostics().ready && layout().rooms[0]!.collapsed === true,
        "Wide packed room did not collapse",
      );
      check(
        fixture.projection.rooms[0]!.desks.length === 100 &&
          fixture.activated.length === 1,
        "Wide collapse changed qualified room membership",
      );
      return;
    }
    scroll.scrollTo({ top: layout().rooms[120]!.y, behavior: "instant" });
    await wait(
      () =>
        diagnostics().ready &&
        document.activeElement?.getAttribute("data-target-key") ===
          target.key &&
        Boolean(targetButton()) &&
        !targetButton()!.closest("[inert]"),
      "Viewport scrolling lost the focused qualified control",
    );
    check(
      document.activeElement?.getAttribute("data-target-key") === target.key,
      "Offscreen focused pane was remounted or lost",
    );
    const findButton = (label: string) =>
      [...fixture.host.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === label,
      )!;
    findButton("Rooms").click();
    await wait(
      () =>
        fixture.host.querySelector(".world-office-navigator-list button") !==
        null,
      "Room navigator did not open",
    );
    check(
      fixture.host.querySelectorAll(".world-office-navigator-list button")
        .length <= 50,
      "Room navigator mounts an unbounded roster",
    );
    fixture.host
      .querySelector<HTMLButtonElement>(".world-office-navigator-list button")!
      .click();
    const collapse = () =>
      [
        ...fixture.host.querySelectorAll<HTMLButtonElement>(
          "button[data-room-key]",
        ),
      ].find(
        (button) =>
          button.dataset.roomKey === firstRoom.key &&
          button.getAttribute("aria-expanded") === "true",
      );
    await wait(
      () => diagnostics().ready && Boolean(collapse()) && !collapse()!.disabled,
      "Room header was not revealable",
    );
    collapse()!.click();
    await wait(
      () => diagnostics().ready && layout().rooms[0]!.collapsed === true,
      "Room collapse did not update geometry",
    );
    check(
      fixture.projection.rooms[0]!.desks.length === 100 &&
        fixture.activated.length === 1,
      "Collapse changed native membership or terminal ownership",
    );
    findButton("Rooms").click();
    await wait(
      () =>
        fixture.host.querySelector(".world-office-navigator-list button") !==
        null,
      "Room navigator did not reopen",
    );
    findButton("Next").click();
    await wait(
      () =>
        fixture.host
          .querySelector(".world-office-navigator-list button")
          ?.textContent?.includes("Room 51") === true,
      "Room navigator pagination did not reach later rooms",
    );
    findButton("Next").click();
    await wait(
      () =>
        [
          ...fixture.host.querySelectorAll(
            ".world-office-navigator-list button",
          ),
        ].some((button) => button.textContent?.includes("Room 129")),
      "Final room was lost beyond 128 rooms",
    );
    const finalRoomButton = [
      ...fixture.host.querySelectorAll<HTMLButtonElement>(
        ".world-office-navigator-list button",
      ),
    ].find((button) => button.textContent?.includes("Room 129"))!;
    finalRoomButton.click();
    const lastIndex = fixture.projection.rooms.findIndex(
      (room) =>
        room.hostKey === firstRoom.hostKey && room.displayLabel === "Room 129",
    );
    await wait(
      () =>
        scroll.scrollTop >= layout().rooms[lastIndex]!.y - scroll.clientHeight,
      "Room picker did not jump beyond the tall room",
    );
    findButton("Rooms").click();
    await wait(
      () =>
        fixture.host.querySelector(".world-office-navigator-list button") !==
        null,
      "Room picker did not reopen for expansion",
    );
    fixture.host
      .querySelector<HTMLButtonElement>(".world-office-navigator-list button")!
      .click();
    await wait(
      () => diagnostics().ready && layout().rooms[0]!.collapsed !== true,
      "Room did not expand after navigation",
    );
    scroll.scrollTo({ top: layout().rooms[lastIndex]!.y, behavior: "instant" });
    await wait(
      () =>
        diagnostics().ready &&
        scroll.scrollTop >= layout().rooms[lastIndex]!.y - scroll.clientHeight,
      "Late room did not settle before refresh",
    );
    const anchorIndex = layout()
      .rooms.filter(
        (room) =>
          !room.hiddenByHost &&
          room.y + room.height > scroll.scrollTop &&
          room.y < scroll.scrollTop + scroll.clientHeight,
      )
      .sort(
        (a, b) =>
          Math.abs(a.y - scroll.scrollTop) - Math.abs(b.y - scroll.scrollTop),
      )[0]!.index;
    const anchoredTop = layout().rooms[anchorIndex]!.y - scroll.scrollTop;
    const oldDigest = layout().inputDigest;
    fixture.addTabs();
    await wait(
      () => diagnostics().ready && layout().inputDigest !== oldDigest,
      "New observation did not grow the room",
    );
    check(
      Math.abs(
        layout().rooms[anchorIndex]!.y - scroll.scrollTop - anchoredTop,
      ) <= 1,
      `Growing an earlier room moved the current room anchor: before=${anchoredTop}, after=${layout().rooms[anchorIndex]!.y - scroll.scrollTop}, top=${scroll.scrollTop}, y=${layout().rooms[anchorIndex]!.y}`,
    );
    if (innerWidth > 720) {
      const visible = layout()
        .rooms.filter(
          (room) =>
            room.y + room.height > scroll.scrollTop &&
            room.y < scroll.scrollTop + scroll.clientHeight,
        )
        .sort(
          (left, right) =>
            Math.abs(left.y - scroll.scrollTop) -
            Math.abs(right.y - scroll.scrollTop),
        )[0]!;
      const key = fixture.projection.rooms[visible.index]!.key;
      fixture.host.style.width = "390px";
      await wait(
        () =>
          diagnostics().ready &&
          layout().compact === true &&
          scroll.clientWidth <= 390,
        "Office did not switch to its phone geometry",
      );
      const phoneVisible = layout().rooms.find(
        (room) => room.y + room.height > scroll.scrollTop,
      )!;
      check(
        fixture.projection.rooms[phoneVisible.index]!.key === key,
        "Responsive change lost the visible qualified room",
      );
      check(
        scroll.scrollWidth <= scroll.clientWidth + 1,
        "Responsive phone scene retained desktop horizontal extent",
      );
      fixture.host.style.width = "";
      await wait(
        () => diagnostics().ready && layout().compact !== true,
        "Office did not restore its desktop geometry",
      );
    }
    const agentPicker = [
      ...fixture.host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Agents ·"))!;
    agentPicker.click();
    await wait(
      () =>
        fixture.host.querySelector('input[aria-label="Find Office agents"]') !==
        null,
      "Agent roster did not open",
    );
    const input = fixture.host.querySelector<HTMLInputElement>(
      'input[aria-label="Find Office agents"]',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "idle");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(
      () =>
        fixture.host.querySelectorAll(".world-office-navigator-list button")
          .length === 1,
      "Idle agent was not reachable in the complete roster",
    );
    fixture.host
      .querySelector<HTMLButtonElement>(".world-office-navigator-list button")!
      .click();
    const idle = fixture.projection.roster.find(
      (entry) => entry.agent.semanticStatus === "idle",
    )!.agent;
    await wait(
      () => fixture.activated.includes(idle.nodeId),
      "Idle agent roster did not open its exact qualified terminal",
    );
  } finally {
    fixture.dispose();
  }
}

export async function verifyHostBuildings(
  check: (condition: boolean, message: string) => void,
) {
  const fixture = mountGrowingOffice({ roomCount: 3, firstRoomTabs: 12 });
  const wait = async (condition: () => boolean, message: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  const diagnostics = () => window.__HERDR_WORLD_RENDERER__!;
  const layout = () => diagnostics().publishedLayout!;
  const hostKey = fixture.projection.hosts[0]!.key;
  const hostButton = () =>
    [
      ...fixture.host.querySelectorAll<HTMLButtonElement>(
        "button[data-host-key]",
      ),
    ].find((button) => button.dataset.hostKey === hostKey);
  const roomKey = fixture.projection.rooms[0]!.key;
  const roomButton = () =>
    [
      ...fixture.host.querySelectorAll<HTMLButtonElement>(
        "button[data-room-key]",
      ),
    ].find(
      (button) =>
        button.dataset.roomKey === roomKey &&
        button.hasAttribute("aria-expanded"),
    );
  try {
    await wait(
      () =>
        diagnostics()?.ready === true &&
        layout().rooms.length === 5 &&
        layout().buildings?.length === 3,
      "Host building fixture did not become ready",
    );
    const scroll = fixture.host.querySelector<HTMLElement>(
      ".world-stage-scroll",
    )!;
    scroll.scrollTo({
      top: layout().buildings![0]!.headerRect.y,
      left: 0,
      behavior: "instant",
    });
    await wait(
      () =>
        diagnostics().ready && Boolean(roomButton()) && !roomButton()!.disabled,
      "Host room header was not reachable",
    );
    roomButton()!.click();
    await wait(
      () => diagnostics().ready && layout().rooms[0]!.collapsed === true,
      "Room did not collapse inside its building",
    );
    await wait(
      () => Boolean(hostButton()) && !hostButton()!.disabled,
      "Host collapse header was not reachable",
    );
    hostButton()!.focus();
    hostButton()!.click();
    await wait(
      () => diagnostics().ready && layout().buildings![0]!.collapsed === true,
      "Host did not collapse",
    );
    check(
      layout()
        .rooms.slice(0, 3)
        .every((room) => room.hiddenByHost) &&
        layout()
          .rooms.slice(3)
          .every((room) => !room.hiddenByHost),
      "Host collapse crossed a qualified host boundary",
    );
    check(
      document.activeElement === hostButton() &&
        hostButton()!.textContent!.includes("3 rooms"),
      "Collapsed host lost focus or its truthful summary",
    );
    hostButton()!.click();
    await wait(
      () => diagnostics().ready && layout().buildings![0]!.collapsed === false,
      "Host did not expand",
    );
    check(
      layout().rooms[0]!.collapsed === true && !layout().rooms[1]!.collapsed,
      "Expanding a host lost individual room collapse state",
    );
    hostButton()!.click();
    await wait(
      () => diagnostics().ready && layout().buildings![0]!.collapsed === true,
      "Host did not collapse before room navigation",
    );
    [...fixture.host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Rooms")!
      .click();
    await wait(
      () =>
        Boolean(
          fixture.host.querySelector(".world-office-navigator-list button"),
        ),
      "Host room navigator did not open",
    );
    fixture.host
      .querySelector<HTMLButtonElement>(".world-office-navigator-list button")!
      .click();
    await wait(
      () =>
        diagnostics().ready &&
        !layout().rooms[0]!.hiddenByHost &&
        !layout().rooms[0]!.collapsed,
      "Room navigation did not expand its qualified host and room",
    );
    check(
      fixture.projection.rooms[0]!.desks.length === 12 &&
        fixture.activated.length === 0,
      "Host collapse changed native contents or opened a terminal",
    );
  } finally {
    fixture.dispose();
  }
}
