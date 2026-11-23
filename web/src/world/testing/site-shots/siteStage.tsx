/*
 * The website's synthetic stage, shared by herdr.world's screenshots
 * (SiteShots.browser.tsx) and the help pictures
 * (web/src/help/testing/HelpShots.browser.tsx): the service's reads answered
 * from the scene (scene.ts), Town's room actions as no-ops, and Board's saved
 * state empty. Nothing contacts World, Herdr or GitHub. Everything is built
 * when called, after the page has seeded Math.random.
 */
import { useState } from "react";
import {
  ClipboardList,
  Crown,
  DoorOpen,
  Headphones,
  Shirt,
  UserPlus,
} from "lucide-react";
import { bridge } from "../../../api";
import type { ConnectionClient } from "../../../connectionClient";
import { BoardDocumentStore } from "../../board/boardDocument";
import type { TownQuietMarks } from "../../town/TownBoard";
import { TownCanvas, type TownRoomActions } from "../../town/TownCanvas";
import type { TownCenterAction } from "../../town/TownCenterMenu";
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

export const noAction = () => {};
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

/**
 * The service's reads answer from the scene: usage for the economy and fuel
 * boards, and each agent's latest conversation for its thought bubble.
 * `call` answers anything else a page needs (Chat's history, say).
 */
export function installSiteBridge(
  call?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown> | undefined,
) {
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
          (await call?.(method, params)) ??
          (method === "agent_conversation.latest"
            ? {
                conversations: (params.pane_ids as string[]).map((pane) =>
                  siteConversation(pane, Date.now()),
                ),
              }
            : {}),
      };
      clients.set(connectionId, client);
    }
    return client;
  };
}

/** Town's projection and summary, as after a morning away. */
export function siteTownScene(now = Date.now()) {
  const world = buildWorldObject(siteConnections(), "site-host-0");
  const projection = projectWorldOffice(
    world,
    now,
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
  return { world, projection, summary };
}

/**
 * The town center ring's first-ring actions (useTownCenter.ts), inert: the
 * help picture of the ring (#1261). Town adds Lenses and Buildings.
 */
const centerActions: TownCenterAction[] = [
  {
    id: "launch",
    label: "New agent",
    icon: UserPlus,
    primary: true,
    run: noAction,
  },
  { id: "master", label: "Town master", icon: Crown, run: noAction },
  { id: "focus", label: "Focus", icon: Headphones, run: noAction },
  { id: "summary", label: "Summary", icon: ClipboardList, run: noAction },
  { id: "profiles", label: "Profiles", icon: Shirt, run: noAction },
  { id: "room", label: "New room", icon: DoorOpen, run: noAction },
];

export function SiteTown({
  scene,
  quiet,
}: {
  scene: ReturnType<typeof siteTownScene>;
  /** Quiet working agents' marks and the board's line (useTownQuiet.ts). */
  quiet?: TownQuietMarks;
}) {
  const [store] = useState(() => new TownStepStore());
  useTownStepReads(store, scene.world.leaves, false);
  return (
    <TownCanvas
      projection={scene.projection}
      summary={scene.summary}
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
      quiet={quiet}
      centerActions={centerActions}
    />
  );
}

/** Board's saved state: nothing arranged, no notes. */
export function siteBoardStore() {
  return new BoardDocumentStore({
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
}

/** Code's projects: every room on both hosts, grouped by host. */
export function siteCodeWorld() {
  return buildWorldObject(siteConnections());
}

/** Board shows one host, so its cards stay legible at a laptop's width. */
export function siteBoardWorld() {
  return buildWorldObject(siteConnections().slice(0, 1), "site-host-0");
}
