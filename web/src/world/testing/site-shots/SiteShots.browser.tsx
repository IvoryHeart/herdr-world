/*
 * The website's Town in the production TownCanvas, for herdr.world's
 * screenshots (scripts/site-screenshots.ts). Real time and real motion with
 * a fixed random sequence; nothing contacts World, Herdr or GitHub. The
 * post office shows its own synthetic parcels (`?townPostFixture`).
 */
window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";
let seed = 0x73697465;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "../../../api";
import type { ConnectionClient } from "../../../connectionClient";
import { BoardDocumentStore } from "../../board/boardDocument";
import BoardView from "../../BoardView";
import { TownCanvas, type TownRoomActions } from "../../town/TownCanvas";
import { TownStepStore } from "../../town/townStepStore";
import { useTownStepReads } from "../../town/useTownStepReads";
import { townCalls } from "../../town/TownRail";
import { townSummary } from "../../town/townSummary";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../../officeObservability";
import { buildWorldObject } from "../../worldObject";
import { siteConnections, siteConversation, siteUsage } from "./scene";
import "../../../styles/tokens.css";
import "../../../styles/base.css";
import "../../world.css";

const noAction = () => {};
const unavailable = async () => "returned" as const;
const roomActions: TownRoomActions = {
  showCreateSeat: () => true,
  canCreateSeat: () => true,
  createSeatReason: () => null,
  onNewAgent: noAction,
  canCreateRoom: () => true,
  createRoomReason: () => null,
  onCreateRoom: noAction,
  addRoomState: () => ({ visible: true, enabled: true, reason: null }),
  onAddRoom: noAction,
  canRenameRoom: () => true,
  onRenameRoom: noAction,
  canCloseRoom: () => true,
  onCloseRoom: noAction,
  onChoosePanes: noAction,
  onMoveDesk: noAction,
  onMoveAgent: noAction,
  placeColor: () => null,
  onDropDesk: unavailable,
  onReorderDesk: unavailable,
  onDropAgent: unavailable,
  onGroupDesk: unavailable,
  onUngroupDesk: unavailable,
};

const loadedAt = Date.now();
// The service's reads answer from the scene: usage for the economy and fuel
// boards, and each agent's latest conversation for its thought bubble.
bridge.call = async (method) =>
  method === "world.usage.get" ? siteUsage(Date.now()) : {};
const clients = new Map<string, ConnectionClient>();
bridge.connection = (connectionId: string) => {
  let client = clients.get(connectionId);
  if (!client) {
    client = {
      connectionId,
      generation: 1,
      serverRuntimeGeneration: 1,
      isCurrent: () => true,
      acceptsServerGeneration: () => true,
      call: async (method, params = {}) =>
        method === "agent_conversation.latest"
          ? {
              conversations: (params.pane_ids as string[]).map((pane) =>
                siteConversation(pane, Date.now()),
              ),
            }
          : {},
    };
    clients.set(connectionId, client);
  }
  return client;
};

const world = buildWorldObject(siteConnections(), "site-host-0");
const projection = projectWorldOffice(
  world,
  loadedAt,
  null,
  TOWN_PRESENTATION_BOUNDS,
);
// Finished agents are unreviewed, as after a morning away: they wait at
// reception and the town board counts them done.
const entries = new Map(
  projection.roster.map((entry) => [entry.agent.key, entry]),
);
const summary = townSummary(
  projection,
  townCalls(
    projection.roster,
    new Map(),
    projection.roster
      .map((entry) => entry.agent)
      .filter((agent) => agent.semanticStatus === "done"),
    (key) => entries.get(key),
  ),
  EMPTY_OFFICE_OBSERVABILITY,
);

function SiteTown() {
  const [store] = useState(() => new TownStepStore());
  useTownStepReads(store, world.leaves, false);
  return (
    <TownCanvas
      projection={projection}
      summary={summary}
      steps={store}
      selectedKey={null}
      completionSeenKeys={new Set()}
      conversationTargets={[]}
      onSelect={noAction}
      onActivateAgent={noAction}
      onActivateRoom={noAction}
      roomActions={roomActions}
      selectedRoomKey={null}
      observability={EMPTY_OFFICE_OBSERVABILITY}
    />
  );
}

const board = new BoardDocumentStore({
  call: async () => ({
    version: 1,
    revision: 1,
    layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
    notes: [],
    strings: [],
  }),
  onControl: () => noAction,
  onStatus: () => noAction,
});

// Board shows one host, so its cards stay legible at a laptop's width.
const boardWorld = buildWorldObject(
  siteConnections().slice(0, 1),
  "site-host-0",
);
const view = new URLSearchParams(location.search).get("view") ?? "town";

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const stats = () => window.__HERDR_TOWN_RENDERER__!;

/** Waits until the camera and actors stop moving, or `limit` ms pass. */
async function settle(limit = 8000) {
  const began = performance.now();
  let calm = 0;
  while (performance.now() - began < limit) {
    await frame();
    const s = stats();
    calm = s.flying || s.transitioning || s.walking ? 0 : calm + 1;
    if (calm >= 45) break;
  }
  return {
    level: stats().level,
    zoom: stats().zoom,
    bubbles: document.querySelectorAll(".town-step").length,
  };
}

function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `${view === "board" ? "" : ".town-zoom "}button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No ${label} button`);
  button.click();
}

const site = {
  ready: (async () => {
    await document.fonts.ready;
    const root = createRoot(document.getElementById("root")!);
    if (view === "board") {
      root.render(
        <div style={{ position: "fixed", inset: 0, display: "flex" }}>
          <BoardView
            world={boardWorld}
            selectedId={null}
            onSelect={noAction}
            onOpen={async () => {}}
            store={board}
          />
        </div>,
      );
      for (let i = 0; i < 240; i++) await frame();
      return { cards: document.querySelectorAll(".board-workspace").length };
    }
    root.render(
      <div className="town-stage" style={{ position: "fixed", inset: 0 }}>
        <SiteTown />
      </div>,
    );
    while (!stats()?.ready) await frame();
    return {
      desks: stats().desks,
      actors: stats().actors,
      ...(await settle(12_000)),
    };
  })(),
  /** Whole town (ALL), then each Zoom in step: building, room, desk. */
  async zoom(step: "all" | "in" | "out") {
    if (view === "board") {
      click(
        step === "in"
          ? "Zoom in"
          : step === "out"
            ? "Zoom out"
            : "Fit everything",
      );
      for (let i = 0; i < 90; i++) await frame();
      return { cards: document.querySelectorAll(".board-workspace").length };
    }
    click(
      step === "all"
        ? "Show the whole town"
        : step === "in"
          ? "Zoom in"
          : "Zoom out",
    );
    return settle();
  },
  settle,
};

Object.assign(window, { siteShots: site });
