import type { Workspace } from "../types";

const SOURCE = { folder: "folder", tab: "tab", agent: "first agent" } as const;

/**
 * Why a room's name is World's own, for its plate and card: a space the
 * runtime left unnamed is named from its folder, tab or agent (#1103).
 * Null for a room whose runtime named it.
 */
export function derivedRoomNameHint(
  workspace: Pick<Workspace, "label_derived_from"> | undefined,
): string | null {
  const source = workspace?.label_derived_from;
  return source && source in SOURCE
    ? `Named from its ${SOURCE[source]}; the space has no name`
    : null;
}
