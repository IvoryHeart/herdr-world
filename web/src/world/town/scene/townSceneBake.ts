/**
 * What the renderer bakes, and what to bake again after a change. Each
 * building's interior (tables in their desks' colours, carpets in their rooms'
 * colours), façade and roof (its host's theme and colour, and whether the
 * host is stale) and its desks' pins are baked into textures and pods. A change re-bakes only the buildings whose own bake
 * inputs changed; a change to the town's size or any building's rectangle
 * rebuilds the whole scene, ground and outdoor items included.
 */

import type { TownLayout } from "../townLayout";
import type { TownModel } from "../townModel";

export type TownBakeKeys = {
  /** The town's size and each building's rectangle. */
  scene: string;
  /** Each building's own bake inputs, by host key. */
  buildings: ReadonlyMap<string, string>;
};

/** What each part of the town is baked from. */
export function townBakeKeys(
  model: Pick<TownModel, "deskColors" | "deskPins" | "placeColors" | "hosts">,
  layout: TownLayout,
): TownBakeKeys {
  const buildings = new Map<string, string>();
  for (const b of layout.buildings) {
    // The theme (skin, else the host key's hash), roof colour and staleness.
    const office = model.hosts.get(b.hostKey);
    const host = `${office?.deterministicSkin.themeIndex ?? "-"}#${model.placeColors.hosts.get(b.hostKey) ?? ""}${office?.stale ? "#stale" : ""}`;
    const rooms = b.rooms.map((r) => {
      const carpet = model.placeColors.rooms.get(r.key) ?? "";
      const cells = r.cells.map((c) =>
        c.deskKey
          ? `${c.deskKey}#${c.seats}#${model.deskColors.get(c.deskKey) ?? "blue"}${model.deskPins.has(c.deskKey) ? "#pin" : ""}`
          : "-",
      );
      return `${r.key}@${r.x},${r.y},${r.w},${r.h}=${carpet}:${cells.join(",")}`;
    });
    buildings.set(b.hostKey, `${host}/${rooms.join("|")}`);
  }
  return {
    scene: `${layout.width}x${layout.height}:${layout.buildings.map((b) => `${b.hostKey}@${b.x},${b.y},${b.w},${b.h}`).join(";")}`,
    buildings,
  };
}

/** What to bake again: the whole scene, or the buildings whose inputs changed. */
export type TownBakeDirty = { scene: boolean; buildings: ReadonlySet<string> };

export function townBakeDirty(
  previous: TownBakeKeys | null,
  next: TownBakeKeys,
): TownBakeDirty {
  if (!previous || previous.scene !== next.scene)
    return { scene: true, buildings: new Set() };
  const buildings = new Set<string>();
  for (const [hostKey, key] of next.buildings)
    if (previous.buildings.get(hostKey) !== key) buildings.add(hostKey);
  return { scene: false, buildings };
}

/**
 * The walking agents' sprites to drop when one building is baked again: its
 * own agents' (they live in its container), and any whose agent is gone.
 * Other buildings' agents keep theirs.
 */
export function townActorViewsToDrop(
  viewKeys: Iterable<string>,
  hostOf: (agentKey: string) => string | undefined,
  hostKey: string,
): string[] {
  return [...viewKeys].filter((key) => {
    const host = hostOf(key);
    return host === undefined || host === hostKey;
  });
}
