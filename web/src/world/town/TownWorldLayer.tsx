import { AnswerDeliverySign } from "./AnswerDeliverySign";
import { Fragment, memo, useMemo, useRef } from "react";
import { ChevronsLeft, ChevronsRight, Plus } from "lucide-react";
import { ConnectionRecoveryBanner } from "../ConnectionRecoveryBanner";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import { TOWN_DESK_EXPANSION_STEP } from "../herdrOfficeProjection";
import { TERMINAL_COLOR_HEX } from "../terminalColor";
import { DeskWorkBadge } from "./DeskWorkBadge";
import type { TownHud } from "./scene/townHud";
import { useTownAges } from "./useTownHud";
import { TownBuildingSign } from "./TownBuildingSign";
import type { TownBuildingSigns } from "./townBuildingSigns";
import type { TownRoomActions } from "./TownCanvas";
import { ReceptionEntry, portrait } from "./TownReceptionEntry";
import { townRoomCardMeta } from "./townNameplates";
import {
  TownRoomOverviewSummary,
  TownRoomPlaque,
  type TownPlaceCardContent,
} from "./TownRoomPlaque";
import { TownDeskTitle } from "./TownDeskTitle";
import { TownStepBubble } from "./TownStepBubble";
import { TownFuelMark } from "./TownFuelMark";
import type { TownStepStore } from "./townStepStore";
import { TownCityBillboard, TownReceptionExpenses } from "./TownExpenseBoards";
import { TownPostOffice } from "./TownPostOffice";
import type { OfficeQualifiedTarget } from "../officeProjectionTypes";
import {
  townPlaceSummary,
  type TownPlace,
  type TownSummary,
} from "./townSummary";
import { TownFoldIndicators } from "./TownFoldIndicators";
import { TownTargets } from "./TownAccessibleTargets";
import { TownTidyRooms } from "./TownTidyRooms";
import { TownAddRoom } from "./TownAddRoom";
import type { TownDeskBadge } from "./townBadges";
import {
  townFoldedActivityLabel,
  type TownFoldedActivity,
} from "./townFoldedActivity";
import { TOWN_TILE as T, townDeskSlots, type TownLayout } from "./townLayout";
import { townAttention, townRoomCounts, type TownModel } from "./townModel";
import { townCarpetFor, townCarpetOf } from "./townPaint";
import { TownQuestPennant, type TownQuestMark } from "./townQuestPennant";
import { TownTiredMark } from "./TownTiredMark";
import { agentContextFill, useContextUsage } from "../agentContextFill";
import { townReceptionBoard } from "./townReception";
import type { TownReceptionTakes } from "./townReceptionFilter";
import { TownReceptionHeldTag, TownReceptionSign } from "./TownReceptionSign";
import type { TownRendererHandle } from "./townRenderer";
import type { TownBuildingLayers } from "./townBuildingLayers";
import {
  TOWN_RECEPTION_LIFT,
  type TownBoardPlacement,
} from "./townBoardPlacement";
import type { TownTarget } from "./townTargets";
import { townWallPath, type TownTeams } from "./townTeams";
import type { TownVisible } from "./townVisibleHosts";

const WALL_RADIUS = 10;

/** Team walls and connectors, under the world layer's cards. */
/**
 * Where a room's DOM press landed: its overview card, the name on that card,
 * the name on its plaque or its plaque's Move handle. A press on a name or
 * the handle can carry the room.
 */
export type TownRoomPress =
  | "card"
  | "card-name"
  | "plaque-name"
  | "plaque-move";

/** A room card's or name's press, passed to the town beneath it. */
export type TownRoomCardPress = (
  event: PointerEvent,
  roomKey: string,
  press: TownRoomPress,
) => boolean;

export const TownTeamsLayer = memo(function TownTeamsLayer({
  teams,
}: {
  teams: TownTeams;
}) {
  if (!teams.walls.length && !teams.links.length) return null;
  return (
    <svg className="town-teams" aria-hidden="true" data-testid="town-teams">
      {teams.walls.map((wall) => {
        const shared = {
          className: "town-team-wall",
          "data-team": wall.team,
          "data-current": String(wall.current),
          "data-desks": wall.desks,
          style: { stroke: TERMINAL_COLOR_HEX[wall.color] },
        };
        return wall.outline ? (
          <path
            key={wall.key}
            {...shared}
            data-shape="outline"
            d={townWallPath(wall.outline, WALL_RADIUS)}
          />
        ) : (
          <rect
            key={wall.key}
            {...shared}
            x={wall.x}
            y={wall.y}
            width={wall.w}
            height={wall.h}
            rx={WALL_RADIUS}
          />
        );
      })}
      {teams.links.map((link) => (
        <line
          key={link.key}
          className="town-team-link"
          data-kind={link.kind}
          data-current={String(link.current)}
          x1={link.x1}
          y1={link.y1}
          x2={link.x2}
          y2={link.y2}
        />
      ))}
    </svg>
  );
});
export const TownWorldLayer = memo(function TownWorldLayer({
  hud,
  model,
  foldedActivity,
  askingKeys,
  receptionHeldKeys,
  receptionTakes,
  onFindHeld,
  onActivateAsk,
  layout,
  selectedKey,
  blockedSince,
  roomActions,
  selectedRoomKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onRoomCardPress,
  onFocusTarget,
  visible,
  onHoverEntry,
  targets,
  deskBadges,
  quests,
  steps,
  renderer,
  pennants,
  signs,
  layers,
  boards,
  summary,
  openDeskKey,
  openReceptionKey,
  openRoomKey,
}: {
  /** The HUD store: the ages clock. */
  hud: TownHud;
  /** The Town summary; room and table cards show their part of it. */
  summary: TownSummary;
  /** The table under the mouse, or tapped, on the canvas: its card is open. */
  openDeskKey: string | null;
  /** The building whose hidden (desk level) reception board a tap brought back. */
  openReceptionKey: string | null;
  /** The room under the mouse on the canvas: zoomed out, its card is open. */
  openRoomKey: string | null;
  signs: TownBuildingSigns;
  /** Moves each building's layer with its building (townBuildingLayers.ts). */
  layers: TownBuildingLayers;
  /** Keeps the reception boards and the billboard off what they'd cover. */
  boards: TownBoardPlacement;
  model: TownModel;
  askingKeys: ReadonlySet<string>;
  /** Agents the reception filter keeps at their desks (townReceptionFilter). */
  receptionHeldKeys: ReadonlySet<string>;
  /** The marks each building's reception takes. */
  receptionTakes: TownReceptionTakes;
  /** Find the agents a reception's filter keeps at their desks. */
  onFindHeld?: (
    keys: readonly string[],
    anchor: { x: number; y: number },
  ) => void;
  onActivateAsk?: (nodeId: string) => void;
  foldedActivity: ReadonlyMap<string, TownFoldedActivity>;
  layout: TownLayout;
  visible: TownVisible;
  /** Accessible targets from the scene model (townTargets). */
  targets: readonly TownTarget[];
  /** Pull request or ticket chips for desks (World sources). */
  deskBadges: ReadonlyMap<string, TownDeskBadge>;
  /** Quests by agent key, as pennants at their seats. */
  quests: ReadonlyMap<string, TownQuestMark>;
  /** Working agents' current steps, as thought bubbles at their seats. */
  steps?: TownStepStore;
  /** Tells a pennant whether its agent is seated. */
  renderer: { readonly current: TownRendererHandle | null };
  pennants: Set<HTMLElement>;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
  selectedKey: string | null;
  blockedSince: ReadonlyMap<string, number>;
  roomActions: TownRoomActions;
  selectedRoomKey: string | null;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  /**
   * A press on a room card or a room's name, passed to the town beneath: a
   * hold over a desk lifts it, a drag or hold on a name carries the room, a
   * tap on a card zooms the room. False when the town cannot take it.
   */
  onRoomCardPress?: TownRoomCardPress;
  onFocusTarget(target: TownTarget): void;
}) {
  // A card press the town took ends as the town's tap; only keyboard
  // activation (or an untaken press) zooms through the card's own click.
  const cardPressTaken = useRef(false);
  // Context fills, for a tired look at nearly full agents' seats.
  const usage = useContextUsage(true);
  const terminalAsksByHost = useMemo(() => {
    type Device = (typeof model.projection.paneRoster)[number]["device"];
    const byHost = new Map<string, Device[]>();
    if (!askingKeys.size) return byHost;
    for (const { device } of model.projection.paneRoster) {
      if (device.agentKey || !askingKeys.has(device.nodeId)) continue;
      const group = byHost.get(device.hostKey) ?? [];
      group.push(device);
      byHost.set(device.hostKey, group);
    }
    return byHost;
  }, [model.projection.paneRoster, askingKeys]);
  const attention = townAttention(model, blockedSince, askingKeys);
  // Waiting ages move on every 15 s while anyone waits (scene/townHud.ts).
  const now = useTownAges(hud, attention.length > 0);
  const selectedHost = selectedRoomKey
    ? model.rooms.get(selectedRoomKey)?.hostKey
    : undefined;
  /** A room's carpet: its workspace's chosen colour, else its own default. */
  const roomCarpet = (roomKey: string) => {
    const chosen = model.placeColors.rooms.get(roomKey);
    return chosen
      ? townCarpetOf(TERMINAL_COLOR_HEX[chosen])
      : townCarpetFor(roomKey);
  };
  /**
   * A room's or table's card: its part of the summary, made on first open,
   * and the usage of its Herdr workspace or tab.
   */
  const placeCard = (
    place: TownPlace,
    target: OfficeQualifiedTarget,
  ): TownPlaceCardContent => ({
    summary: () => townPlaceSummary(summary, model.projection, place),
    usage: { kind: place.kind, target },
  });
  const folded = layout.formFactor === "narrow";
  /** A host's room by its workspace, for its reception's expenses. */
  const roomLabel =
    (hostKey: string) => (workspaceId: string, generation: number) => {
      for (const room of model.rooms.values())
        if (
          room.hostKey === hostKey &&
          room.workspaceRef.nativeId === workspaceId &&
          room.workspaceRef.generation === generation
        )
          return room.accessibleLabel ?? room.displayLabel;
      return null;
    };
  return (
    <>
      <TownCityBillboard
        center={layout.center}
        folded={folded}
        boardRef={boards.cityRef}
      />
      <TownPostOffice layout={layout} renderer={renderer} />
      {layout.buildings.map((building) => {
        if (!visible.hosts.has(building.hostKey)) return null;
        const host = model.hosts.get(building.hostKey);
        const hostColor = roomActions.placeColor("host", building.hostKey);
        const queue = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            agent.semanticStatus === "blocked",
        );
        const questions = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            askingKeys.has(agent.key) &&
            agent.semanticStatus !== "blocked",
        );
        const terminalQuestions =
          terminalAsksByHost.get(building.hostKey) ?? [];
        const questionCount = questions.length + terminalQuestions.length;
        // The filter moves bodies, not facts: the counts above stay whole,
        // and only the agents this reception takes wait in it.
        const {
          visitors,
          kept: held,
          keptCounts: heldCounts,
        } = townReceptionBoard(
          building.hostKey,
          attention,
          terminalQuestions,
          askingKeys,
          receptionHeldKeys,
          receptionTakes(building.hostKey),
        );
        const shown = visitors.slice(0, 6);
        const counts = building.rooms.reduce(
          (sum, placed) => {
            const room = model.rooms.get(placed.key);
            if (!room) return sum;
            const c = townRoomCounts(model, room);
            return {
              rooms: sum.rooms + 1,
              desks: sum.desks + c.desks,
              working: sum.working + c.working,
            };
          },
          { rooms: 0, desks: 0, working: 0 },
        );
        return (
          <div
            key={building.hostKey}
            ref={layers.ref(building.hostKey)}
            className="town-building-layer"
            data-stale={host?.stale || undefined}
          >
            <TownBuildingSign
              hostKey={building.hostKey}
              signs={signs}
              left={(building.x + building.w / 2) * T}
              top={(building.y + building.h * 0.38) * T}
            >
              <strong>{host?.displayLabel ?? building.hostKey}</strong>
              {host?.stale ? (
                <ConnectionRecoveryBanner
                  connectionId={host.connectionId}
                  label={host.displayLabel}
                  state={host.runtimeState}
                />
              ) : (
                <span>{`${counts.rooms} rooms · ${counts.desks} desks · ${counts.working} working`}</span>
              )}
              <TownTidyRooms
                hostKey={building.hostKey}
                hostLabel={host?.displayLabel}
                roomActions={roomActions}
                named
              />
              <div className="town-reception-tags">
                {queue.length ? (
                  <em aria-label={`${queue.length} need you`}>
                    !{queue.length}
                  </em>
                ) : null}
                {questionCount ? (
                  <em
                    className="town-reception-question"
                    aria-label={`${questionCount} owner questions`}
                  >
                    ?{questionCount}
                  </em>
                ) : null}
                {host ? (
                  <AnswerDeliverySign connectionId={host.connectionId} />
                ) : null}
              </div>
            </TownBuildingSign>
            <div
              ref={boards.receptionRef(building.hostKey)}
              className={`town-reception${queue.length ? " town-reception-busy" : ""}`}
              data-stale={host?.stale || undefined}
              data-open={building.hostKey === openReceptionKey || undefined}
              style={{
                // The board stands in the yard above the front door, moved
                // off the town center and other boards (townBoardPlacement).
                left: (building.entryX + 0.5) * T,
                top: building.y * T - TOWN_RECEPTION_LIFT,
              }}
              role="group"
              aria-label={`${host?.displayLabel ?? "Host"} reception, ${queue.length} waiting`}
            >
              <div className="town-reception-title">
                {hostColor ? (
                  <ColorSwatchButton
                    className="town-place-color"
                    label={`Colour of ${host?.displayLabel ?? "host"}'s building`}
                    {...hostColor}
                  />
                ) : null}
                <span>
                  {(host?.displayLabel ?? "").toUpperCase()} RECEPTION
                </span>
                {queue.length ? <b>{queue.length}</b> : null}
                <TownTidyRooms
                  hostKey={building.hostKey}
                  hostLabel={host?.displayLabel}
                  roomActions={roomActions}
                />
                {host && folded ? (
                  <TownReceptionExpenses
                    connectionId={host.connectionId}
                    hostLabel={host.displayLabel}
                    roomLabel={roomLabel(building.hostKey)}
                    folded
                  />
                ) : null}
                {host ? (
                  <TownReceptionSign
                    connectionId={host.connectionId}
                    hostLabel={host.displayLabel}
                  />
                ) : null}
              </div>
              {host?.stale ? (
                <ConnectionRecoveryBanner
                  connectionId={host.connectionId}
                  label={host.displayLabel}
                  state={host.runtimeState}
                />
              ) : null}
              {visitors.length ? (
                <div className="town-reception-queue">
                  {shown.map((agent) =>
                    "semanticStatus" in agent ? (
                      <ReceptionEntry
                        key={agent.key}
                        agent={agent}
                        room={model.rooms.get(agent.roomKey)?.displayLabel}
                        desk={
                          agent.deskKey
                            ? model.desks.get(agent.deskKey)?.displayLabel
                            : undefined
                        }
                        asking={askingKeys.has(agent.key)}
                        since={blockedSince.get(agent.key) ?? now}
                        now={now}
                        selected={selectedKey === agent.key}
                        onSelect={onSelect}
                        onActivate={onActivate}
                        onHoverEntry={onHoverEntry}
                      />
                    ) : (
                      <button
                        key={agent.key}
                        type="button"
                        className="town-reception-entry"
                        data-owner-question="true"
                        data-owner-question-terminal={agent.nodeId}
                        aria-label={`${agent.displayLabel}, owner question`}
                        disabled={agent.stale || !agent.canOpenInSpaces}
                        onClick={() => onActivateAsk?.(agent.nodeId)}
                      >
                        <img
                          src={portrait(agent.key)}
                          alt=""
                          width={28}
                          height={40}
                        />
                        <span>{agent.displayLabel}</span>
                        <small>? Owner wanted</small>
                      </button>
                    ),
                  )}
                  {visitors.length > shown.length ? (
                    <span className="town-reception-more">
                      +{visitors.length - shown.length}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="town-reception-empty">Nobody waiting</div>
              )}
              <TownReceptionHeldTag
                counts={heldCounts}
                onFind={
                  held.length && onFindHeld
                    ? (anchor) =>
                        onFindHeld(
                          held.map((agent) => agent.key),
                          anchor,
                        )
                    : null
                }
              />
              {host && !folded ? (
                <TownReceptionExpenses
                  connectionId={host.connectionId}
                  hostLabel={host.displayLabel}
                  roomLabel={roomLabel(building.hostKey)}
                  folded={false}
                />
              ) : null}
            </div>
            {building.rooms.map((placed) => {
              const room = model.rooms.get(placed.key);
              if (!room) return null;
              const c = townRoomCounts(model, room);
              const label = room.accessibleLabel ?? room.displayLabel;
              const total = Math.max(1, c.agents);
              const seatCell =
                placed.foldActionCells?.[0] ??
                placed.cells.find((cell) => !cell.deskKey);
              const foldCell = placed.foldActionCells?.[1];
              const overflow =
                room.omittedDeskCount + placed.overflowDeskKeys.length;
              const revealCount = Math.min(TOWN_DESK_EXPANSION_STEP, overflow);
              const activity = foldedActivity.get(room.key);
              const activityLabel = townFoldedActivityLabel(activity);
              const partiallyExpanded =
                room.deskFold === "expanded" && overflow > 0;
              const revealDescription =
                overflow > TOWN_DESK_EXPANSION_STEP
                  ? `Show up to ${revealCount} more hidden ${revealCount === 1 ? "desk" : "desks"}`
                  : `Show the remaining ${overflow} hidden ${overflow === 1 ? "desk" : "desks"}`;
              const reason = roomActions.createSeatReason(room.key);
              const roomColor = roomActions.placeColor("room", room.key);
              const add =
                roomActions.showCreateSeat(room.key) && seatCell ? (
                  <button
                    className="world-new-seat-canvas-action town-new-seat"
                    type="button"
                    aria-label={`New agent or terminal in ${label}`}
                    title={reason ?? `New agent or terminal in ${label}`}
                    disabled={!roomActions.canCreateSeat(room.key)}
                    style={
                      partiallyExpanded
                        ? undefined
                        : {
                            left: (seatCell.x - placed.x + 1) * T,
                            top: (seatCell.y - placed.y) * T + 4,
                          }
                    }
                    onClick={() => roomActions.onNewAgent(room.key)}
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                ) : null;
              const toggle =
                room.deskFold &&
                foldCell &&
                roomActions.onToggleFold &&
                (room.deskFold === "expanded" || overflow > 0) ? (
                  <button
                    className="town-new-seat town-fold-tile"
                    type="button"
                    aria-expanded={room.deskFold === "expanded"}
                    aria-label={
                      overflow > 0
                        ? `${revealDescription} in ${label}${activityLabel ? `. ${activityLabel}` : ""}`
                        : `Fold ${label} back to 24 desks`
                    }
                    title={
                      overflow > 0
                        ? `${revealDescription}${activityLabel ? `. ${activityLabel}` : ""}`
                        : "Fold this room back to 24 desks"
                    }
                    style={{
                      ...(partiallyExpanded && seatCell
                        ? {}
                        : {
                            left: (foldCell.x - placed.x + 1) * T,
                            top: (foldCell.y - placed.y) * T + 4,
                            width: 72,
                          }),
                      display: "flex",
                      justifyContent: "center",
                      gap: 3,
                    }}
                    onClick={() =>
                      roomActions.onToggleFold?.(
                        room.key,
                        overflow > 0
                          ? Math.min(
                              room.observedDeskCount,
                              room.desks.length + TOWN_DESK_EXPANSION_STEP,
                            )
                          : undefined,
                      )
                    }
                  >
                    {overflow > 0 ? (
                      <>
                        <ChevronsRight size={16} aria-hidden="true" />
                        <span>+{overflow}</span>
                      </>
                    ) : (
                      <>
                        <ChevronsLeft size={16} aria-hidden="true" />
                        <span>Fold</span>
                      </>
                    )}
                    <TownFoldIndicators activity={activity} />
                  </button>
                ) : null;
              return (
                <div
                  key={room.key}
                  className="town-room"
                  style={{
                    left: placed.x * T,
                    top: placed.y * T,
                    width: placed.w * T,
                    height: placed.h * T,
                  }}
                >
                  {visible.cards ? (
                    <TownRoomOverviewSummary
                      card={placeCard(
                        { kind: "room", key: room.key },
                        room.workspaceRef,
                      )}
                      open={room.key === openRoomKey}
                    >
                      <button
                        type="button"
                        className={`town-room-card${c.blocked ? " town-room-card-waiting" : ""}${selectedKey === room.key ? " town-selected" : ""}`}
                        style={
                          {
                            "--room-w": `${placed.w * T}px`,
                            "--carpet": roomCarpet(room.key),
                            // Presses pass to the town: a pan, or a hold that
                            // lifts the table beneath.
                            touchAction: "none",
                          } as React.CSSProperties
                        }
                        aria-label={`${label}: ${c.desks} desks, ${c.working} working${c.blocked ? `, ${c.blocked} need you` : ""}${c.done ? `, ${c.done} done` : ""}. Zoom in.`}
                        onPointerDown={(event) => {
                          cardPressTaken.current =
                            onRoomCardPress?.(
                              event.nativeEvent,
                              room.key,
                              (event.target as Element).closest?.(
                                ".town-room-card-name",
                              )
                                ? "card-name"
                                : "card",
                            ) ?? false;
                        }}
                        onClick={(event) => {
                          const taken =
                            cardPressTaken.current && event.detail > 0;
                          cardPressTaken.current = false;
                          if (!taken) onActivateRoom(room.key);
                        }}
                        tabIndex={-1}
                      >
                        <span className="town-room-card-name">{label}</span>
                        {c.blocked ? (
                          <span className="town-room-card-badge">
                            !{c.blocked}
                          </span>
                        ) : null}
                        <span className="town-room-card-meta">
                          {townRoomCardMeta(c, overflow)}
                        </span>
                        <span className="town-room-card-bar" aria-hidden="true">
                          {(
                            ["working", "blocked", "done", "idle"] as const
                          ).map((status) =>
                            c[status] ? (
                              <i
                                key={status}
                                data-status={status}
                                style={{ flexGrow: c[status] / total }}
                              />
                            ) : null,
                          )}
                        </span>
                      </button>
                    </TownRoomOverviewSummary>
                  ) : null}
                  {visible.tagRooms.has(room.key)
                    ? placed.cells.map((cell) => {
                        const desk = cell.deskKey
                          ? model.desks.get(cell.deskKey)
                          : undefined;
                        if (!desk) return null;
                        return (
                          <div
                            key={desk.key}
                            className="town-desk-tags"
                            style={
                              {
                                left: (cell.x + 1 - placed.x) * T,
                                top: (cell.y - placed.y) * T,
                                "--desk-color":
                                  TERMINAL_COLOR_HEX[
                                    model.deskColors.get(desk.key) ?? "blue"
                                  ],
                              } as React.CSSProperties
                            }
                          >
                            {desk.appearanceStatus ? (
                              <span
                                className="town-appearance-status"
                                title={desk.appearanceStatus}
                              >
                                {desk.appearanceStatus}
                              </span>
                            ) : null}
                            <TownDeskTitle
                              deskKey={desk.key}
                              label={desk.displayLabel}
                              card={placeCard(
                                { kind: "desk", key: desk.key },
                                desk.tabRef,
                              )}
                              open={desk.key === openDeskKey}
                              onSelect={onSelect}
                              onActivate={onActivate}
                            >
                              <span
                                className="town-desk-name"
                                aria-hidden="true"
                              >
                                {desk.displayLabel}
                              </span>
                              <DeskWorkBadge
                                badge={deskBadges.get(desk.key)}
                                deskLabel={desk.displayLabel}
                              />
                            </TownDeskTitle>
                            {desk.observedPaneCount >
                            desk.paneDevices.length ? (
                              <button
                                type="button"
                                className="town-desk-more"
                                aria-label={`All ${desk.observedPaneCount} panes at ${desk.displayLabel}`}
                                onClick={() =>
                                  roomActions.onChoosePanes(desk.key)
                                }
                              >
                                +
                                {desk.observedPaneCount -
                                  desk.paneDevices.length}
                              </button>
                            ) : null}
                            {townDeskSlots(cell.seats).map((slot, seat) => {
                              const device = desk.paneDevices[seat];
                              const quest = device?.agentKey
                                ? quests.get(device.agentKey)
                                : undefined;
                              const fill =
                                device?.agentKey && !device.stale
                                  ? agentContextFill(usage, {
                                      connectionId: device.paneRef.connectionId,
                                      generation: device.paneRef.generation,
                                      paneId: device.paneRef.nativeId,
                                    })
                                  : null;
                              const usageStop = device?.agentKey
                                ? model.agents.get(device.agentKey)?.usageStop
                                : undefined;
                              return device ? (
                                <Fragment key={device.key}>
                                  <span
                                    aria-hidden="true"
                                    className={`town-seat-tag${slot.top ? " town-seat-tag-top" : ""}${device.agentKey ? "" : " town-seat-tag-shell"}`}
                                    style={{ left: slot.chairX + 7 }}
                                  >
                                    {device.displayLabel}
                                  </span>
                                  {steps &&
                                  device.agentKey &&
                                  !askingKeys.has(device.agentKey) &&
                                  model.agents.get(device.agentKey)
                                    ?.semanticStatus === "working" ? (
                                    <TownStepBubble
                                      steps={steps}
                                      hud={hud}
                                      agentKey={device.agentKey}
                                      top={slot.top}
                                      x={slot.chairX + 7}
                                      selected={
                                        selectedKey === device.agentKey ||
                                        selectedKey === desk.key
                                      }
                                      renderer={renderer}
                                      pennants={pennants}
                                    />
                                  ) : null}
                                  {usageStop ? (
                                    <TownFuelMark
                                      stop={usageStop}
                                      agentKey={device.agentKey!}
                                      top={slot.top}
                                      x={slot.chairX + 7}
                                      renderer={renderer}
                                      pennants={pennants}
                                    />
                                  ) : null}
                                  {quest ? (
                                    <TownQuestPennant
                                      quest={quest}
                                      agentKey={device.agentKey!}
                                      agentLabel={device.displayLabel}
                                      renderer={renderer}
                                      pennants={pennants}
                                      top={slot.top}
                                      x={slot.chairX + 7}
                                    />
                                  ) : null}
                                  {fill?.tired ? (
                                    <TownTiredMark
                                      fill={fill}
                                      agentKey={device.agentKey!}
                                      agentLabel={device.displayLabel}
                                      renderer={renderer}
                                      marks={pennants}
                                      top={slot.top}
                                      x={slot.chairX + 7}
                                    />
                                  ) : null}
                                </Fragment>
                              ) : null;
                            })}
                          </div>
                        );
                      })
                    : null}
                  <TownRoomPlaque
                    room={room}
                    label={label}
                    width={placed.w * T}
                    counts={c}
                    color={
                      roomColor && {
                        defaultHex: townCarpetFor(room.key),
                        ...roomColor,
                      }
                    }
                    actions={roomActions}
                    card={placeCard(
                      { kind: "room", key: room.key },
                      room.workspaceRef,
                    )}
                    onNamePress={(event, press) =>
                      onRoomCardPress?.(event, room.key, press) ?? false
                    }
                  />
                  {partiallyExpanded && seatCell ? (
                    // Add, Expand and Fold in one row whose right end
                    // stays put; zoomed out, it grows left so each tile
                    // keeps a 40px touch target (town.css).
                    <div
                      className="town-room-actions"
                      style={{
                        left: (seatCell.x - placed.x + 1) * T + 152,
                        top: (seatCell.y - placed.y) * T + 4,
                      }}
                    >
                      {add}
                      {toggle}
                      {roomActions.onToggleFold ? (
                        <button
                          className="town-new-seat town-fold-reset"
                          type="button"
                          aria-label={`Fold ${label} back to 24 desks`}
                          title="Fold this room back to 24 desks"
                          onClick={() => roomActions.onToggleFold?.(room.key)}
                        >
                          <ChevronsLeft size={18} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      {add}
                      {toggle}
                    </>
                  )}
                  {add && reason && seatCell ? (
                    <span
                      className="world-creation-reason town-creation-reason"
                      role="status"
                      style={{
                        left: (seatCell.x - placed.x + 1) * T,
                        top: (seatCell.y - placed.y) * T + 60,
                      }}
                    >
                      {reason}
                    </span>
                  ) : null}
                </div>
              );
            })}
            <TownAddRoom
              building={building}
              hostLabel={host?.displayLabel ?? "host"}
              roomActions={roomActions}
              selectedRoomKey={
                selectedHost === building.hostKey ? selectedRoomKey : null
              }
            />
          </div>
        );
      })}
      <TownTargets
        targets={targets}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onActivate={onActivate}
        onActivateRoom={onActivateRoom}
        onFocusTarget={onFocusTarget}
        onMoveTarget={(kind, key) =>
          kind === "desk"
            ? roomActions.onMoveDesk(key)
            : roomActions.onMoveAgent(key)
        }
      />
    </>
  );
});
