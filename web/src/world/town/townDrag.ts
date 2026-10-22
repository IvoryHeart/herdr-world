import type { TownLevel } from "./townCamera";
import type { TownHit } from "./townHitTest";
import type { TownModel } from "./townModel";

/** A desk or agent being dragged, and where it would land. */
export type TownDrag = {
  kind: "desk" | "agent";
  key: string;
  hostKey: string;
  /** The desk's room, or the agent's desk: dropping there does nothing. */
  from: string;
  label: string;
  target?: TownDropTarget;
};

/**
 * Where a drag lands: a desk dropped on a room moves there; on another desk
 * it joins that desk's team (moving rooms first when needed); a grouped desk
 * dropped on its own room's floor leaves its team.
 */
export type TownDropTarget = {
  key: string | null;
  label: string;
  action?: "move" | "group" | "ungroup";
};

/** What a held press picks up: a desk or a seated agent, zoomed in. */
export function townDragFor(
  hit: TownHit | null,
  model: TownModel,
  level: TownLevel,
): TownDrag | null {
  if (!hit || (level !== "room" && level !== "desk")) return null;
  if (hit.kind === "agent") {
    const agent = model.agents.get(hit.key);
    const seat = model.agentSeats.get(hit.key);
    if (!agent || !seat || !agent.canOpenInSpaces || agent.stale) return null;
    return {
      kind: "agent",
      key: agent.key,
      hostKey: agent.hostKey,
      from: seat.deskKey,
      label: `Move ${agent.displayLabel}`,
    };
  }
  const deskKey =
    hit.kind === "desk" ? hit.key : hit.kind === "pane" ? hit.deskKey : null;
  const desk = deskKey ? model.desks.get(deskKey) : undefined;
  if (!desk || !desk.canOpenInSpaces) return null;
  return {
    kind: "desk",
    key: desk.key,
    hostKey: desk.hostKey,
    from: desk.roomKey,
    label: `Move ${desk.displayLabel}`,
  };
}

/** How long a dragged desk rests on another desk before it snaps to it. */
export const TOWN_MAGNET_MS = 450;

/** The desk under a dragged desk, if it is one it could group with. */
export function townMagnetDesk(
  drag: TownDrag,
  hit: TownHit | null,
  model: TownModel,
): string | null {
  if (drag.kind !== "desk") return null;
  const key =
    hit?.kind === "desk"
      ? hit.key
      : hit?.kind === "pane"
        ? hit.deskKey
        : hit?.kind === "agent"
          ? model.agentSeats.get(hit.key)?.deskKey
          : undefined;
  return key && key !== drag.key && model.desks.has(key) ? key : null;
}

/**
 * Where a drag would land under the pointer, or why it can't. A desk dropped
 * at once on another desk means that desk's room; held still on it for
 * TOWN_MAGNET_MS (`magnet`), it snaps to that desk and groups with it, so
 * moving (or reordering) and grouping stay separate gestures.
 */
export function townDropTarget(
  drag: TownDrag,
  hit: TownHit | null,
  model: TownModel,
  /** Each related desk's team (townTeams.ts). */
  deskTeams: ReadonlyMap<string, string> = new Map(),
  /** The desk the dragged desk has rested on long enough to snap to. */
  magnet: string | null = null,
  /** Desks in a manual group: only these can leave one. */
  groupedDesks: ReadonlySet<string> = new Set(),
): TownDropTarget {
  if (drag.kind === "desk") {
    const desk = magnet ? model.desks.get(magnet) : undefined;
    if (desk && magnet === townMagnetDesk(drag, hit, model)) {
      if (desk.hostKey !== drag.hostKey)
        return { key: null, label: "Desks group only within one host" };
      const team = deskTeams.get(desk.key);
      if (team && team === deskTeams.get(drag.key))
        return { key: null, label: `${drag.label}: already in this team` };
      return {
        key: desk.key,
        label: `Group with ${desk.displayLabel}`,
        action: "group",
      };
    }
    const roomKey =
      hit?.kind === "room"
        ? hit.key
        : hit?.kind === "cell"
          ? hit.roomKey
          : hit?.kind === "desk"
            ? model.desks.get(hit.key)?.roomKey
            : hit?.kind === "pane"
              ? model.desks.get(hit.deskKey)?.roomKey
              : hit?.kind === "agent"
                ? model.agents.get(hit.key)?.roomKey
                : undefined;
    const room = roomKey ? model.rooms.get(roomKey) : undefined;
    if (!room) return { key: null, label: `${drag.label}: drop on a room` };
    if (room.hostKey !== drag.hostKey)
      return { key: null, label: "Desks move only within one host" };
    if (room.key === drag.from)
      return groupedDesks.has(drag.key) && !townMagnetDesk(drag, hit, model)
        ? { key: room.key, label: "Leave the team", action: "ungroup" }
        : { key: null, label: `${drag.label}: already in this room` };
    return {
      key: room.key,
      label: `${drag.label} to ${room.displayLabel}`,
      action: "move",
    };
  }
  const deskKey =
    hit?.kind === "desk"
      ? hit.key
      : hit?.kind === "pane"
        ? hit.deskKey
        : hit?.kind === "agent"
          ? model.agentSeats.get(hit.key)?.deskKey
          : undefined;
  const desk = deskKey ? model.desks.get(deskKey) : undefined;
  if (!desk) return { key: null, label: `${drag.label}: drop on a desk` };
  if (desk.hostKey !== drag.hostKey)
    return { key: null, label: "Agents move only within one host" };
  if (desk.key === drag.from)
    return { key: null, label: `${drag.label}: already at this desk` };
  return { key: desk.key, label: `${drag.label} to ${desk.displayLabel}` };
}
