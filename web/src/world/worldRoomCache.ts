import type { Workspace } from "../types";
import type { WorldSpaceObject } from "./worldObject";

// A room's observation slice plus owner/presentation metadata; immutable workspace
// keys keep retirement bounded by the lifetime of held observations. Two variants
// retain selected/unselected presentations without collecting an edit history.
const rooms = new WeakMap<Workspace, Map<string, WorldSpaceObject>>();
export function roomInputCache(
  workspace: Workspace,
  inputs: readonly unknown[],
) {
  const fingerprint = JSON.stringify(inputs);
  let variants = rooms.get(workspace);
  if (!variants) rooms.set(workspace, (variants = new Map()));
  return {
    value: variants.get(fingerprint),
    save(value: WorldSpaceObject) {
      if (variants.size >= 2) variants.delete(variants.keys().next().value!);
      variants.set(fingerprint, value);
    },
  };
}
