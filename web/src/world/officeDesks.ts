import type { OfficeAgent, OfficeDesk } from "./herdrOfficeProjection";
import type { WorldAgentStatus } from "./worldObject";

export function prioritizeRoomRoster<T>(
  items: T[],
  range: [number, number] | undefined,
): T[] {
  if (!range || range[0] === 0 || range[0] === range[1]) return items;
  return [
    ...items.slice(range[0], range[1]),
    ...items.slice(0, range[0]),
    ...items.slice(range[1]),
  ];
}

export function priorityCandidates(
  top: OfficeAgent[],
  selected: OfficeAgent | undefined,
) {
  return selected && !top.some((agent) => agent.key === selected.key)
    ? [...top, selected]
    : top;
}

/**
 * A room's desks within its bound, in tab order. The optional Town policy
 * keeps selected, pinned, active, attention and newest desks even when that
 * means exceeding the fold target. Other Town desks are kept by status, with
 * unnamed, idle and finished desks folded first. Identity breaks ties so a
 * stable snapshot always produces the same fold set; other callers retain the
 * default bounded selection.
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
  protectActiveAndRecent = false,
  attention: (desk: OfficeDesk) => boolean = () => false,
): OfficeDesk[] {
  if (desks.length <= limit && !protectActiveAndRecent) return [...desks];
  const need = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.deskKey) continue;
    const rank = DESK_STATUS_RANK[agent.semanticStatus];
    need.set(agent.deskKey, Math.min(need.get(agent.deskKey) ?? 9, rank));
  }
  if (!protectActiveAndRecent) {
    const newestStart = desks.length - NEWEST_DESKS_KEPT;
    const ranked = desks
      .map((desk, index) => ({
        desk,
        index,
        rank: selected(desk)
          ? -3
          : pinned(desk)
            ? -2
            : index >= newestStart
              ? -1
              : (need.get(desk.key) ?? UNNAMED_DESK_RANK),
      }))
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          right.index - left.index ||
          left.desk.key.localeCompare(right.desk.key),
      );
    const retained = Math.max(
      limit,
      desks.filter((desk) => selected(desk) || pinned(desk)).length,
    );
    const admitted = new Set(ranked.slice(0, retained).map(({ desk }) => desk));
    return desks.filter((desk) => admitted.has(desk));
  }
  const newest = new Set(
    [...desks]
      .sort(
        (left, right) =>
          right.order - left.order || left.key.localeCompare(right.key),
      )
      .slice(0, NEWEST_DESKS_KEPT)
      .map((desk) => desk.key),
  );
  const protectedDesk = (desk: OfficeDesk) => {
    const status = need.get(desk.key);
    return (
      selected(desk) ||
      pinned(desk) ||
      attention(desk) ||
      newest.has(desk.key) ||
      status === DESK_STATUS_RANK.blocked ||
      status === DESK_STATUS_RANK.working
    );
  };
  const protectedDesks = desks.filter(protectedDesk).sort((left, right) => {
    const rank = (desk: OfficeDesk) => {
      const status = need.get(desk.key);
      return selected(desk)
        ? -4
        : pinned(desk)
          ? -3
          : attention(desk) || status === DESK_STATUS_RANK.blocked
            ? -2
            : status === DESK_STATUS_RANK.working
              ? -1
              : 0;
    };
    return rank(left) - rank(right) || left.key.localeCompare(right.key);
  });
  const candidates = desks
    .filter((desk) => !protectedDesk(desk))
    .sort((left, right) => {
      const statusOrder =
        (need.get(left.key) ?? UNNAMED_DESK_RANK) -
        (need.get(right.key) ?? UNNAMED_DESK_RANK);
      return statusOrder || left.key.localeCompare(right.key);
    });
  const admitted = new Set(
    protectedDesks.concat(
      candidates.slice(0, Math.max(0, limit - protectedDesks.length)),
    ),
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
const UNNAMED_DESK_RANK = 5;

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
