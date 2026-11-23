import { useCallback, useMemo, useState } from "react";
import type {
  BoardElement,
  BoardElementInput,
  BoardElementReadParams,
} from "../../../../../shared/boardElements";
import type {
  BoardDocument,
  BoardDocumentStore,
  BoardPoint,
} from "../boardDocument";
import type { WorldObject } from "../../worldObject";
import { type AddDialogHost, BoardAddDialog } from "./BoardAddDialog";
import { BoardElementReader } from "./BoardElementReader";
import { projectSource } from "./boardElementKinds";
import { requestArtefactFile } from "../../artefactOpen";
import { artefactPlace, sourcePlace } from "./boardElementRead";

/** A Board element ID the service admits: letters, digits, `-`. */
function newElementId(kind: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${kind}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type Dialog =
  | { type: "add" }
  | { type: "edit"; id: string }
  | { type: "read"; id: string };

/**
 * Board's placed elements (memory, logs, docs, links): their saved records,
 * the Add dialog and the reader. BoardView owns the cards' places and
 * gestures, as for notes; this owns what they are and what opening one does.
 * Every write is one world.board.patch op against the element's last `rev`,
 * so a stale edit comes back as the service's conflict, never a silent win.
 */
export function useBoardElements({
  store,
  saved,
  world,
  report,
  centre,
}: {
  store: BoardDocumentStore;
  saved: BoardDocument | null;
  world: Pick<WorldObject, "hosts">;
  /** Shows a write's problem, if any. */
  report(pending: Promise<string | null>): unknown;
  /** Where a new element goes: the middle of the view, in board space. */
  centre(): BoardPoint;
}) {
  const elements = saved?.elements ?? [];
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );
  const placeOf = useCallback(
    (element: BoardElement) => {
      if (element.kind === "artefact")
        return artefactPlace(world, element.source);
      const project = projectSource(element);
      return project ? sourcePlace(world, project) : null;
    },
    [world],
  );

  async function save(
    input: Omit<BoardElementInput, "id" | "x" | "y">,
    editing?: BoardElement,
  ): Promise<string | null> {
    if (editing) {
      // `editing` is the record the draft was opened from, so its rev
      // belongs to the draft. A newer rev (another browser, the CLI, a move)
      // makes the service refuse, and the draft stays for the person to
      // copy before they reopen it: a stale draft never overwrites.
      const problem = await store.patch([
        {
          op: "element.put",
          element: {
            ...input,
            id: editing.id,
            x: editing.x,
            y: editing.y,
          } as BoardElementInput,
          rev: editing.rev,
        },
      ]);
      const current = byId.get(editing.id);
      if (problem && current && current.rev !== editing.rev)
        return "This changed somewhere else while you were editing, so it was not saved. Copy your text, then close and open it again.";
      return problem;
    }
    // Each new element lands a little beside the last, so several added in
    // a row do not hide one another.
    const at = centre();
    const step = (elements.length % 6) * 28;
    const id = newElementId(input.kind);
    const problem = await store.patch([
      {
        op: "element.put",
        element: {
          ...input,
          id,
          x: Math.round(at.x + step),
          y: Math.round(at.y + step),
        } as BoardElementInput,
      },
    ]);
    if (!problem) setSelected(id);
    return problem;
  }

  /** Save a dragged element's new place. */
  function move(id: string, at: BoardPoint) {
    const element = byId.get(id);
    if (!element || (element.x === at.x && element.y === at.y)) return;
    const { rev, ...rest } = element;
    void report(
      store.patch([
        {
          op: "element.put",
          element: {
            ...rest,
            x: Math.round(at.x),
            y: Math.round(at.y),
          } as BoardElementInput,
          rev,
        },
      ]),
    );
  }

  /** Take it off Board; the file or address it points at stays. */
  function remove(element: BoardElement) {
    setDialog(null);
    setSelected(null);
    void report(
      store.patch([{ op: "element.delete", id: element.id, rev: element.rev }]),
    );
  }

  const read = useCallback(
    (params: BoardElementReadParams) => store.readElement(params),
    [store],
  );

  return {
    elements,
    selected,
    select: setSelected,
    placeOf,
    move,
    remove,
    open(id: string) {
      setSelected(id);
      setDialog({ type: "read", id });
    },
    openAdd() {
      setDialog({ type: "add" });
    },
    /** The dialog open now, if any; BoardView renders it over the board. */
    render(routes: {
      newWorkspaceHosts: AddDialogHost[];
      preferredProject: { connectionId: string; workspaceId: string } | null;
      onNote(): void;
      onWork(): void;
      onNewWorkspace(hostKey: string): void;
      /** Opens an agent's Inspector on its Files view. */
      onOpenFiles(nodeId: string): unknown;
    }) {
      if (!dialog) return null;
      const close = () => setDialog(null);
      if (dialog.type === "add" || dialog.type === "edit") {
        const editing =
          dialog.type === "edit" ? byId.get(dialog.id) : undefined;
        if (dialog.type === "edit" && !editing) return null;
        return (
          <BoardAddDialog
            world={world}
            editing={editing}
            newWorkspaceHosts={routes.newWorkspaceHosts}
            preferredProject={routes.preferredProject}
            onNote={() => {
              close();
              routes.onNote();
            }}
            onWork={() => {
              close();
              routes.onWork();
            }}
            onNewWorkspace={(hostKey) => {
              close();
              routes.onNewWorkspace(hostKey);
            }}
            onSave={save}
            onClose={close}
          />
        );
      }
      const element = byId.get(dialog.id);
      if (!element) return null;
      const place = placeOf(element);
      // An artefact file, text or not (an image, a PDF), opens in World's
      // Files viewer through a live agent on its saved connection.
      const file =
        element.kind === "artefact" && "file" in element.source
          ? element.source.file
          : null;
      const viewerId = place?.generation != null ? place.viewerId : null;
      const openFiles =
        file !== null
          ? viewerId
            ? () => {
                close();
                requestArtefactFile(viewerId, file);
                void Promise.resolve(routes.onOpenFiles(viewerId)).catch(
                  () => undefined,
                );
              }
            : null
          : undefined;
      return (
        <BoardElementReader
          element={element}
          place={place}
          read={read}
          onOpenFiles={openFiles}
          onEdit={() => setDialog({ type: "edit", id: element.id })}
          onRemove={() => remove(element)}
          onClose={close}
        />
      );
    },
  };
}
