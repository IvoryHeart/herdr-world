/**
 * Town's facts for Board (#787): the same read models Town reads, computed
 * from the same World with Town's own functions, so every number Board shows
 * is Town's number for the same thing. Nothing here is Board's own copy:
 *
 * - counts, hosts and unreviewed finishes are the Town summary
 *   (town/townSummary.ts) over Town's office projection, with Town's
 *   finishes (town/townFinished.ts) and the one reviewed record
 *   (useReviewedWork.ts) applied as Town applies them;
 * - each agent's status as Town presents it (a finished, unreviewed agent is
 *   done; a reviewed one is quiet) comes from that same projection.
 *
 * Board passes no selection, pins or expanded rooms: those change which
 * desks Town draws, not what it counts. Board keeps Town's room preparation
 * running while it is shown, so its dense-World work includes Town's.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  createOfficeProjector,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../officeObservability";
import { townCalls, unseenTownCompletions } from "../town/TownRail";
import { townLeaf } from "../town/townChat";
import { useTownFinished, withTownFinished } from "../town/townFinished";
import { townSummary, type TownSummary } from "../town/townSummary";
import { reviewedAgentKeys, useReviewedWork } from "../useReviewedWork";
import { worldRuntimeStore } from "../runtimeStore";
import { useWorldAsks } from "../worldAsks";
import type { WorldAgentStatus, WorldObject } from "../worldObject";

export type BoardFacts = {
  summary: TownSummary;
  /** Each agent's status as Town presents it, by World node ID. */
  presented: ReadonlyMap<string, WorldAgentStatus>;
};

/** Town's office, finishes and reviews as one pure step, for tests. */
export function boardFacts(
  office: Parameters<typeof withTownFinished>[0],
  finished: ReadonlySet<string>,
  reviewed: ReadonlySet<string>,
  world: Pick<WorldObject, "nodeById">,
  asks: Parameters<typeof townSummary>[4],
  blockedSince: Map<string, number>,
): BoardFacts {
  const shown = withTownFinished(office, finished, reviewed);
  const byKey = new Map(shown.roster.map((entry) => [entry.agent.key, entry]));
  const calls = townCalls(
    shown.roster,
    blockedSince,
    unseenTownCompletions(shown.roster, reviewed),
    (key) => byKey.get(key),
  );
  const summary = townSummary(
    shown,
    calls,
    EMPTY_OFFICE_OBSERVABILITY,
    (agent) => townLeaf(world as WorldObject, agent.nodeId)?.lastActivityAt,
    asks,
  );
  const presented = new Map(
    shown.roster.map(({ agent }) => [agent.nodeId, agent.semanticStatus]),
  );
  return { summary, presented };
}

/** Town's facts over `world`, kept as Town keeps them while Board is shown. */
export function useBoardFacts(world: WorldObject): BoardFacts {
  // The runtime prepares Town's rooms in slices for every update, as it does
  // for Town, so the projection below reuses them instead of building them.
  useEffect(() => worldRuntimeStore.retainView("town"), []);
  const project = useMemo(
    () => createOfficeProjector(TOWN_PRESENTATION_BOUNDS),
    [],
  );
  const office = useMemo(
    () => project(world, Date.now(), null),
    [project, world],
  );
  const { finished } = useTownFinished(office);
  const work = useReviewedWork(undefined, false);
  const latest = useRef(world);
  latest.current = world;
  const checked = useRef<ReadonlySet<string>>(new Set());
  const reviewedLeaf = work.reviewed;
  const reviewed = useMemo(
    () =>
      (checked.current = reviewedAgentKeys(
        office.roster,
        finished,
        (nodeId) => townLeaf(latest.current, nodeId),
        reviewedLeaf,
        checked.current,
      )),
    [office, finished, reviewedLeaf],
  );
  const asks = useWorldAsks();
  const blockedSince = useRef(new Map<string, number>());
  return useMemo(
    () =>
      boardFacts(office, finished, reviewed, world, asks, blockedSince.current),
    [office, finished, reviewed, world, asks],
  );
}
