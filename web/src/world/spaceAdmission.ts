import type { WorldSpaceObject } from "./worldObject";

/** Preserve relevant ancestry, then share ordinary capacity across host roots. */
export function admitWorldSpaces<
  T extends { hostIndex: number; space: WorldSpaceObject },
>(ordered: readonly T[], bound: number, selectedSpaceId: string | null): T[] {
  const relevant = (item: T) =>
    item.space.id === selectedSpaceId ||
    item.space.workspace.focused ||
    item.space.children.some(
      (leaf) =>
        leaf.focused ||
        leaf.watched ||
        leaf.status === "blocked" ||
        leaf.status === "working" ||
        leaf.status === "done",
    );
  const admitted = ordered.filter(relevant).slice(0, bound);
  const ordinary = new Map<number, T[]>();
  for (const item of ordered) {
    if (relevant(item)) continue;
    const bucket = ordinary.get(item.hostIndex) ?? [];
    bucket.push(item);
    ordinary.set(item.hostIndex, bucket);
  }
  let offset = 0;
  while (admitted.length < bound) {
    let progressed = false;
    for (const bucket of ordinary.values()) {
      const item = bucket[offset];
      if (item && admitted.length < bound) {
        admitted.push(item);
        progressed = true;
      }
    }
    if (!progressed) break;
    offset++;
  }
  return admitted;
}
