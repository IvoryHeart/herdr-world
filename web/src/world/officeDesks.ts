import type { OfficeDesk } from "./herdrOfficeProjection";
import type { WorldAgentStatus } from "./worldObject";

/**
 * A room's desks within its bound, in tab order. When a room has more, the
 * selected desk and protected desks (pins and Town attention) stay; the newest
 * tabs (Herdr appends new tabs) follow, then
 * desks whose agents need the user, are working or are unknown, then finished
 * ones; idle and empty desks are hidden first, and among equals newer tabs
 * stay. Without protection, excess busy desks are hidden
 * too; every hidden desk is counted on its room (`omittedDeskCount`).
 */
export function boundedDesks(
  desks: readonly OfficeDesk[],
  agents: readonly {
    deskKey: string | null;
    semanticStatus: WorldAgentStatus;
  }[],
  limit: number,
  selected: (desk: OfficeDesk) => boolean,
  pinned: (desk: OfficeDesk) => boolean,
) {
  if (desks.length <= limit) return [...desks];
  const need = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.deskKey) continue;
    const rank = DESK_STATUS_RANK[agent.semanticStatus];
    need.set(agent.deskKey, Math.min(need.get(agent.deskKey) ?? 9, rank));
  }
  const newest = desks.length - NEWEST_DESKS_KEPT;
  const rank = (desk: OfficeDesk, index: number) =>
    selected(desk)
      ? -3
      : pinned(desk)
        ? -2
        : index >= newest
          ? -1
          : (need.get(desk.key) ?? DESK_STATUS_RANK.idle);
  const admitted = new Set(
    desks
      .map((desk, index) => ({ desk, index, rank: rank(desk, index) }))
      .sort((left, right) => left.rank - right.rank || right.index - left.index)
      // The selected and pinned desks stay even past the bound.
      .slice(
        0,
        Math.max(
          limit,
          desks.filter((desk) => selected(desk) || pinned(desk)).length,
        ),
      )
      .map(({ desk }) => desk),
  );
  return desks.filter((desk) => admitted.has(desk));
}

/** After protected desks, prefer this many newest tabs. */
const NEWEST_DESKS_KEPT = 3;

const DESK_STATUS_RANK: Record<WorldAgentStatus, number> = {
  blocked: 0,
  working: 1,
  unknown: 2,
  done: 3,
  idle: 4,
};

/** `first` ranks some priority values ahead of the rest of them. */
export function boundedWithPriority<T>(
  values: readonly T[],
  limit: number,
  priority: (value: T) => boolean,
  first: (value: T) => boolean = () => false,
) {
  if (values.length <= limit) return [...values];
  const admitted = new Set(
    [
      ...values.filter(first),
      ...values.filter((value) => !first(value) && priority(value)),
      ...values.filter((value) => !first(value) && !priority(value)),
    ].slice(0, limit),
  );
  return values.filter((value) => admitted.has(value));
}

export function boundedSorted<T>(
  values: readonly T[],
  limit: number,
  compare: (left: T, right: T) => number,
): T[] {
  const kept: T[] = [];
  for (const value of values) {
    if (kept.length === limit && compare(value, kept[limit - 1]!) >= 0)
      continue;
    let low = 0,
      high = kept.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(value, kept[middle]!) < 0) high = middle;
      else low = middle + 1;
    }
    kept.splice(low, 0, value);
    if (kept.length > limit) kept.pop();
  }
  return kept;
}
