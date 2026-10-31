import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, Plus } from "lucide-react";
import { ConnectionRecoveryBanner } from "../ConnectionRecoveryBanner";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import { TOWN_DESK_EXPANSION_STEP } from "../herdrOfficeProjection";
import { TERMINAL_COLOR_HEX } from "../terminalColor";
import { DeskWorkBadge } from "./DeskWorkBadge";
import { TownBuildingSign } from "./TownBuildingSign";
import type { TownBuildingSigns } from "./townBuildingSigns";
import type { TownRoomActions } from "./TownCanvas";
import { ReceptionEntry, portrait } from "./TownReceptionEntry";
import { TownRoomPlaque } from "./TownRoomPlaque";
import { TownFoldIndicators } from "./TownFoldIndicators";
import { TownTargets } from "./TownAccessibleTargets";
import type { TownDeskBadge } from "./townBadges";
import {
  townFoldedActivityLabel,
  type TownFoldedActivity,
} from "./townFoldedActivity";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  townDeskSlots,
  type TownLayout,
} from "./townLayout";
import { townAttention, townRoomCounts, type TownModel } from "./townModel";
import { townCarpetFor, townCarpetOf } from "./townPaint";
import { TownQuestPennant, type TownQuestMark } from "./townQuestPennant";
import { townReceptionVisitors } from "./townReception";
import type { TownRendererHandle } from "./townRenderer";
import { townTargets, type TownTarget } from "./townTargets";
import type { TownTeams } from "./townTeams";
import type { TownVisible } from "./townVisibleHosts";

/** Team walls and connectors, under the world layer's cards. */
export const TownTeamsLayer = memo(function TownTeamsLayer({
  teams,
}: {
  teams: TownTeams;
}) {
  if (!teams.walls.length && !teams.links.length) return null;
  return (
    <svg className="town-teams" aria-hidden="true" data-testid="town-teams">
      {teams.walls.map((wall) => (
        <rect
          key={wall.key}
          className="town-team-wall"
          data-team={wall.team}
          data-current={String(wall.current)}
          data-desks={wall.desks}
          x={wall.x}
          y={wall.y}
          width={wall.w}
          height={wall.h}
          rx={10}
          style={{ stroke: TERMINAL_COLOR_HEX[wall.color] }}
        />
      ))}
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
  model,
  foldedActivity,
  askingKeys,
  onActivateAsk,
  layout,
  teams,
  selectedKey,
  blockedSince,
  roomActions,
  selectedRoomKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
  visible,
  onHoverEntry,
  deskBadges,
  quests,
  renderer,
  pennants,
  signs,
}: {
  signs: TownBuildingSigns;
  model: TownModel;
  askingKeys: ReadonlySet<string>;
  onActivateAsk?: (nodeId: string) => void;
  foldedActivity: ReadonlyMap<string, TownFoldedActivity>;
  layout: TownLayout;
  teams: TownTeams;
  visible: TownVisible;
  /** Pull request or ticket chips for desks (World sources). */
  deskBadges: ReadonlyMap<string, TownDeskBadge>;
  /** Quests by agent key, as pennants at their seats. */
  quests: ReadonlyMap<string, TownQuestMark>;
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
  onFocusTarget(target: TownTarget): void;
}) {
  const targets = useMemo(
    () => townTargets(model, layout, teams.deskTeams),
    [model, layout, teams.deskTeams],
  );
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
  const now = Date.now();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!attention.length) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [attention.length]);
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
  const newRoomBuilding =
    layout.buildings.find((b) => b.hostKey === selectedHost) ??
    layout.buildings[0];
  return (
    <>
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
        // Questions and finished agents wait after urgent blocked agents.
        const agentVisitors = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            (agent.semanticStatus === "blocked" ||
              agent.semanticStatus === "done" ||
              askingKeys.has(agent.key)),
        );
        const visitors = townReceptionVisitors(
          agentVisitors,
          terminalQuestions,
          askingKeys,
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
              {queue.length ? (
                <em aria-label={`${queue.length} need you`}>!{queue.length}</em>
              ) : null}
              {questionCount ? (
                <em
                  className="town-reception-question"
                  aria-label={`${questionCount} owner questions`}
                >
                  ?{questionCount}
                </em>
              ) : null}
            </TownBuildingSign>
            <div
              className={`town-reception${queue.length ? " town-reception-busy" : ""}`}
              data-stale={host?.stale || undefined}
              style={{
                left: building.doorX * T,
                top: (building.y + building.h + TOWN_FACADE) * T + 6,
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
                    <button
                      type="button"
                      className={`town-room-card${c.blocked ? " town-room-card-waiting" : ""}${selectedKey === room.key ? " town-selected" : ""}`}
                      style={
                        {
                          "--room-w": `${placed.w * T}px`,
                          "--carpet": roomCarpet(room.key),
                        } as React.CSSProperties
                      }
                      aria-label={`${label}: ${c.desks} desks, ${c.working} working${c.blocked ? `, ${c.blocked} need you` : ""}${c.done ? `, ${c.done} done` : ""}. Zoom in.`}
                      onClick={() => onActivateRoom(room.key)}
                      tabIndex={-1}
                    >
                      <span className="town-room-card-name">{label}</span>
                      {c.blocked ? (
                        <span className="town-room-card-badge">
                          !{c.blocked}
                        </span>
                      ) : null}
                      <span className="town-room-card-meta">
                        {c.desks} desks · {c.working} working
                        {overflow ? ` · +${overflow} more` : ""}
                      </span>
                      <span className="town-room-card-bar" aria-hidden="true">
                        {(["working", "blocked", "done", "idle"] as const).map(
                          (status) =>
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
                            <span className="town-desk-tag">
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
                            </span>
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
                              return device ? (
                                <Fragment key={device.key}>
                                  <span
                                    aria-hidden="true"
                                    className={`town-seat-tag${slot.top ? " town-seat-tag-top" : ""}${device.agentKey ? "" : " town-seat-tag-shell"}`}
                                    style={{ left: slot.chairX + 7 }}
                                  >
                                    {device.displayLabel}
                                  </span>
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
                  />
                  {roomActions.showCreateSeat(room.key) && seatCell ? (
                    <>
                      <button
                        className="world-new-seat-canvas-action town-new-seat"
                        type="button"
                        aria-label={`New agent or terminal in ${label}`}
                        title={reason ?? `New agent or terminal in ${label}`}
                        disabled={!roomActions.canCreateSeat(room.key)}
                        style={{
                          left: (seatCell.x - placed.x + 1) * T,
                          top: (seatCell.y - placed.y) * T + 4,
                          ...(partiallyExpanded ? { width: 40 } : {}),
                        }}
                        onClick={() => roomActions.onNewAgent(room.key)}
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                      {reason ? (
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
                    </>
                  ) : null}
                  {room.deskFold &&
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
                        left:
                          partiallyExpanded && seatCell
                            ? (seatCell.x - placed.x + 1) * T + 44
                            : (foldCell.x - placed.x + 1) * T,
                        top: (foldCell.y - placed.y) * T + 4,
                        display: "flex",
                        width: partiallyExpanded ? 64 : 72,
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
                  ) : null}
                  {partiallyExpanded && seatCell && roomActions.onToggleFold ? (
                    <button
                      className="town-new-seat town-fold-reset"
                      type="button"
                      aria-label={`Fold ${label} back to 24 desks`}
                      title="Fold this room back to 24 desks"
                      style={{
                        left: (seatCell.x - placed.x + 1) * T + 112,
                        top: (seatCell.y - placed.y) * T + 4,
                        width: 40,
                      }}
                      onClick={() => roomActions.onToggleFold?.(room.key)}
                    >
                      <ChevronsLeft size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {roomActions.showCreateRoom(selectedRoomKey) && newRoomBuilding ? (
        <div
          className="town-new-room-wrap"
          style={{
            left: (newRoomBuilding.x + 18) * T,
            top: (newRoomBuilding.y + 3) * T,
          }}
        >
          <button
            className="world-new-room-canvas-action town-new-room"
            type="button"
            aria-label="New room"
            title={
              roomActions.createRoomReason(selectedRoomKey) ??
              "Create a new Herdr workspace"
            }
            disabled={!roomActions.canCreateRoom(selectedRoomKey)}
            onClick={() => roomActions.onCreateRoom(selectedRoomKey)}
          >
            <Plus size={16} strokeWidth={3} aria-hidden="true" />
            <span>New room</span>
          </button>
          {roomActions.createRoomReason(selectedRoomKey) ? (
            <span className="world-creation-reason" role="status">
              {roomActions.createRoomReason(selectedRoomKey)}
            </span>
          ) : null}
        </div>
      ) : null}
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
