import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { PodTabInput, WorldPod } from "../pods";
import type { TownInput } from "./townLayout";
import type { TownModel } from "./townModel";

/**
 * Pods in Town (pods.ts): a desk is a tab, so a pod's rounds and author are
 * desks inside one team wall (townTeams.ts) under the pod's plaque. Earlier
 * rounds stack behind the current round's table instead of taking a cell
 * each, unless one of their agents needs you or the desk is pinned. Pure.
 */

export function townPodTabs(projection: HerdrOfficeProjection): PodTabInput[] {
  return projection.rooms.flatMap((room) =>
    room.desks.map((desk) => ({
      key: desk.key,
      connectionId: desk.tabRef.connectionId,
      roomKey: desk.roomKey,
      label: desk.displayLabel,
      panes: desk.paneDevices.map((device) => ({
        paneId: device.paneRef.nativeId,
        generation: device.paneRef.generation,
        agentSessionFingerprint: device.agentSessionFingerprint,
      })),
    })),
  );
}

/** What a pod's plaque and walls depend on, so a refresh that changes none of it keeps the same pods. */
export function townPodsKey(pods: readonly WorldPod[]) {
  return pods
    .map((pod) =>
      [
        pod.key,
        pod.rounds.map((round) => `${round.round}=${round.tabKey}`).join(","),
        pod.authorKeys.join(","),
        pod.state ?? "",
        pod.item?.key ?? "",
        pod.item?.title ?? "",
      ].join("\u0001"),
    )
    .join("\u0002");
}

export type TownPodStacks = {
  /** Earlier-round desks drawn as a stack instead of their own cell. */
  stacked: ReadonlySet<string>;
  /** How many earlier rounds stack behind each current round's desk. */
  stacks: ReadonlyMap<string, number>;
};

export const NO_TOWN_POD_STACKS: TownPodStacks = {
  stacked: new Set(),
  stacks: new Map(),
};

export function townPodStacks(
  model: TownModel,
  pods: readonly WorldPod[],
): TownPodStacks {
  const stacked = new Set<string>();
  const stacks = new Map<string, number>();
  const needsYou = (deskKey: string) =>
    model.desks
      .get(deskKey)
      ?.paneDevices.some(
        (device) =>
          device.agentKey &&
          model.agents.get(device.agentKey)?.semanticStatus === "blocked",
      ) ?? false;
  for (const pod of pods) {
    const present = pod.rounds.filter((round) => model.desks.has(round.tabKey));
    const current = present[present.length - 1];
    if (!current) continue;
    let count = 0;
    for (const round of present.slice(0, -1)) {
      if (needsYou(round.tabKey) || model.deskPins.has(round.tabKey)) continue;
      stacked.add(round.tabKey);
      count += 1;
    }
    if (count) stacks.set(current.tabKey, count);
  }
  return stacked.size ? { stacked, stacks } : NO_TOWN_POD_STACKS;
}

/** The layout input without the stacked desks. */
export function townStackedInput(
  input: TownInput,
  stacked: ReadonlySet<string>,
): TownInput {
  if (!stacked.size) return input;
  return {
    ...input,
    rooms: input.rooms.map((room) => {
      if (!room.deskKeys.some((key) => stacked.has(key))) return room;
      const keep = room.deskKeys.map((key) => !stacked.has(key));
      return {
        ...room,
        deskKeys: room.deskKeys.filter((_, index) => keep[index]),
        deskSeats: room.deskSeats?.filter((_, index) => keep[index]),
      };
    }),
  };
}
