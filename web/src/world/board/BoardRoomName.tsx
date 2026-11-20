import { derivedRoomNameHint } from "../derivedRoomName";
import type { BoardWorkspace } from "./boardModel";

/** A room card's name; one World derived for an unnamed space looks it. */
export function BoardRoomName({ space }: { space: BoardWorkspace }) {
  const hint = derivedRoomNameHint(space.space.workspace);
  return hint ? (
    <span className="board-label is-derived" title={`${space.label}: ${hint}`}>
      {space.label}
    </span>
  ) : (
    <span className="board-label">{space.label}</span>
  );
}
