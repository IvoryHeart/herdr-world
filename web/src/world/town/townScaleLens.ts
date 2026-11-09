/**
 * Synthetic lens facts for the Town scale scene (`?scene=town-scale`), so
 * every lens shows a varied map in a preview: idle times from just now to a
 * day, today's usage (one host reports no data), linked pull requests in
 * every state, quests at every stage and the scene's harnesses.
 *
 * Deterministic: every value follows from a place's synthetic key, so the
 * same scene reads the same on every load, relative to `now`.
 */

import type { WorkItem } from "../../../../shared/worldSources";
import type { LensAgent, LensDesk, TownLensFacts } from "./townLens";
import type { TownPlaceEconomy, TownUsagePlace } from "./townPlaceUsage";
import type { TownQuestMark } from "./townQuestPennant";
import {
  townScaleDeskTokens,
  townScaleRoll,
  TOWN_SCALE_NO_USAGE_HOST,
} from "./townScaleValues";
export { townScaleRoll, TOWN_SCALE_NO_USAGE_HOST } from "./townScaleValues";

const MINUTE = 60_000;
/** Idle minutes: most agents recent, a tail of forgotten ones. */
const IDLE_MINUTES = [1, 3, 12, 25, 48, 95, 180, 320, 610, 1_300] as const;
const PULLS: readonly Pick<
  WorkItem,
  "lane" | "checks" | "draft" | "mergeable" | "review"
>[] = [
  { lane: "fixing", checks: "fail" },
  { lane: "ready", checks: "pass", review: "approved" },
  { lane: "review", checks: "pending" },
  { lane: "green", checks: "pass", review: "review_required" },
  { lane: "review", checks: "pending", draft: true },
  { lane: "merged", checks: "pass" },
  { lane: "fixing", checks: "pass", mergeable: "conflicting" },
];
const QUESTS = [
  "Ship the search index",
  "Retire the old billing flow",
  "Green the nightly build",
  "Document the API",
] as const;

/** The scene's room (workspace) of a synthetic tab or workspace ID. */
const roomOf = (place: TownUsagePlace) =>
  place.kind === "room"
    ? place.target.nativeId
    : place.target.nativeId.replace(/-t\d+$/, "");

export function townScaleLensFacts(
  now: number,
  desksOfRoom: (workspaceNativeId: string) => readonly string[],
): TownLensFacts {
  return {
    now,
    activityAt(agent: LensAgent) {
      const roll = townScaleRoll(agent.key, "idle");
      if (roll > 0.96) return undefined;
      // Some rooms were left alone: their agents run colder.
      const cold = townScaleRoll(agent.roomKey, "cold") > 0.7 ? 3 : 0;
      const band = Math.min(
        IDLE_MINUTES.length - 1,
        Math.floor(roll * (IDLE_MINUTES.length - 3)) + cold,
      );
      return now - IDLE_MINUTES[band]! * MINUTE;
    },
    economy(place: TownUsagePlace): TownPlaceEconomy {
      if (place.target.connectionId === `scene-${TOWN_SCALE_NO_USAGE_HOST}`)
        return { status: "no-data" };
      const tokens =
        place.kind === "desk"
          ? townScaleDeskTokens(place.target.nativeId)
          : desksOfRoom(roomOf(place)).reduce(
              (sum, tabId) => sum + townScaleDeskTokens(tabId),
              0,
            );
      if (tokens === 0) return { status: "none" };
      return {
        status: "ready",
        costUsd: Math.round(tokens * 0.0006) / 100,
        price: "priced",
        tokens,
        models: ["synthetic-model"],
        partial: false,
      };
    },
    work(desk: LensDesk): WorkItem | undefined {
      if (!desk.occupantAgentKey) return undefined;
      const roll = townScaleRoll(desk.key, "pull");
      if (roll > 0.4) return undefined;
      const number = 100 + Math.floor(townScaleRoll(desk.key, "number") * 900);
      const pull = PULLS[Math.floor((roll / 0.4) * PULLS.length)]!;
      return {
        key: `scene:pr:${number}`,
        source: "github",
        kind: "pull_request",
        ref: `example/town#${number}`,
        title: `Synthetic change ${number}`,
        url: `https://example.com/town/pull/${number}`,
        status: pull.lane,
        roles: ["author"],
        updatedAt: now,
        number,
        ...pull,
      };
    },
    quest(agentKey: string): TownQuestMark | undefined {
      const roll = townScaleRoll(agentKey, "quest");
      if (roll > 0.45) return undefined;
      const total = 3 + Math.floor(townScaleRoll(agentKey, "steps") * 4);
      const done = Math.floor((roll / 0.45) * (total + 1));
      const blocked = townScaleRoll(agentKey, "blocked") > 0.85;
      return {
        title:
          QUESTS[Math.floor(townScaleRoll(agentKey, "title") * QUESTS.length)]!,
        progress: `${done}/${total}`,
        done,
        total,
        status: done >= total ? "done" : blocked ? "blocked" : "active",
      };
    },
  };
}
