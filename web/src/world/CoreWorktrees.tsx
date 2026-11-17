import { coreAlsoEndedText } from "../../../shared/coreKill";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CloseButton } from "../components/CloseButton";
import { focusDialogElement } from "../components/dialogFocus";
import { store } from "../store";
import { summarizeDirectHookResult } from "../store/worktree";
import { confirmCoreKill } from "./CoreKillConfirm";
import {
  type CoreTarget,
  type CoreWorktreeEntry,
  type CoreWorktreeHookResult,
  coreKillConfirmation,
  coreKillPlan,
  createCoreWorktree,
  listCoreWorktrees,
  openCoreWorktree,
  removeCoreWorktree,
} from "./coreControl";
import "./CoreWorktrees.css";

/**
 * Git worktrees of a herdr-core room (P4). Herdr's TUI makes a worktree a
 * workspace; on core, World makes it one of its own rooms whose folder is
 * the checkout. One dialog per room: create a worktree from the room's
 * repository, open one Git already lists, or remove this room's worktree
 * (naming every terminal that ends with it first).
 */
export type CoreWorktreeRoom = CoreTarget & {
  workspaceId: string;
  label: string;
  /** This room is a linked worktree World opened: it can be removed. */
  linked: boolean;
};

let pending: CoreWorktreeRoom | null = null;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};

/** Opens the worktree dialog for one core room. */
export function openCoreWorktrees(room: CoreWorktreeRoom) {
  pending = room;
  publish();
}

function closeDialog() {
  pending = null;
  publish();
}

const failure = (message: string, cause: unknown) =>
  store.notify({
    kind: "error",
    message,
    detail: cause instanceof Error ? cause.message : String(cause),
  });

/** A failed hook first; else a hook that ran; else `fallback`. */
function hookNotice(
  hooks: Array<CoreWorktreeHookResult | undefined>,
  fallback: Parameters<typeof store.notify>[0],
) {
  const notices = hooks.flatMap((hook) => {
    const notice = hook ? summarizeDirectHookResult(hook) : null;
    return notice ? [notice] : [];
  });
  store.notify(
    notices.find((notice) => notice.kind === "error") ?? notices[0] ?? fallback,
  );
}

export async function createCoreWorktreeFor(
  room: CoreWorktreeRoom,
  branch: string,
) {
  store.notify({
    kind: "info",
    message: "Creating worktree",
    detail: `Updating origin's default branch before creating ${branch}.`,
    loading: true,
  });
  try {
    const result = await createCoreWorktree(room, room.workspaceId, branch);
    const commit = String(result.base_sync?.commit ?? "").slice(0, 12);
    if (result.command_fallback)
      store.notify({
        kind: "info",
        message: "Worktree created without the worktree command",
        detail: result.command_fallback,
      });
    else
      hookNotice([result.setup_hook], {
        kind: "success",
        message: "Worktree created",
        detail: `Room “${result.label}” is ${result.checkout_path}${
          commit
            ? `, from ${result.base_sync?.base ?? "origin's default branch"} at ${commit}`
            : ""
        }.`,
        autoDismissMs: 6000,
      });
    return result;
  } catch (cause) {
    failure("Failed to create worktree", cause);
    return null;
  }
}

export async function openCoreWorktreeFor(
  room: CoreWorktreeRoom,
  entry: CoreWorktreeEntry,
) {
  try {
    const result = await openCoreWorktree(room, room.workspaceId, entry.path);
    hookNotice([result.opened_hook], {
      kind: "success",
      message: result.already_open
        ? "Worktree already open"
        : "Worktree opened",
      detail: `Room “${result.label}” is ${result.checkout_path}.`,
      autoDismissMs: 5000,
    });
    return result;
  } catch (cause) {
    failure("Failed to open worktree", cause);
    return null;
  }
}

/**
 * Removes a worktree room: every terminal it shows ends first (and what
 * core ends with them), so all are named before anything happens. The
 * service ends nothing beyond what was shown and refuses if more would end.
 */
export async function removeCoreWorktreeConfirmed(room: CoreWorktreeRoom) {
  try {
    const plan = await coreKillPlan(room, { workspaceId: room.workspaceId });
    const count = plan.roots.length + plan.descendants.length;
    const confirmed = await confirmCoreKill({
      title: "Remove worktree",
      message: count
        ? `Remove worktree “${room.label}”? ${count === 1 ? "This terminal ends" : `These ${count} terminals end`}, in World and in Herdr's apps, then its checkout is deleted:`
        : `Remove worktree “${room.label}”? Its checkout is deleted and the room closes. It has no running terminals.`,
      confirmLabel: "Remove worktree",
      plan,
      listRoots: true,
    });
    if (!confirmed) return null;
    store.notify({
      kind: "info",
      message: "Removing worktree",
      detail: "Running the teardown hook if configured.",
      loading: true,
    });
    const result = await removeCoreWorktree(
      room,
      room.workspaceId,
      count ? coreKillConfirmation(plan) : null,
    );
    if (!result.ok) {
      const teardown = result.before_remove_hook
        ? summarizeDirectHookResult(result.before_remove_hook)
        : null;
      store.notify(
        teardown?.kind === "error"
          ? teardown
          : {
              kind: "error",
              message: "Worktree not removed",
              detail: result.message,
            },
      );
      return result;
    }
    const alsoEnded = coreAlsoEndedText(result.alsoEnded);
    if (alsoEnded)
      store.notify({
        kind: "error",
        message: "Worktree removed; additional terminals ended",
        detail: alsoEnded,
      });
    else if (result.command_fallback)
      store.notify({
        kind: "info",
        message: "Worktree removed without the remove command",
        detail: result.command_fallback,
      });
    else
      hookNotice([result.before_remove_hook, result.removed_hook], {
        kind: "success",
        message: "Worktree removed",
        detail: `${result.checkout_path} was removed and its room closed.`,
        autoDismissMs: 5000,
      });
    return result;
  } catch (cause) {
    failure("Failed to remove worktree", cause);
    return null;
  }
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entries: CoreWorktreeEntry[] };

function CoreWorktreeDialog({ room }: { room: CoreWorktreeRoom }) {
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    listCoreWorktrees(room, room.workspaceId).then(
      (entries) => {
        if (live)
          setList({
            kind: "ready",
            entries: entries.filter((entry) => !entry.bare),
          });
      },
      (cause: unknown) => {
        if (live)
          setList({
            kind: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [room]);
  useEffect(() => focusDialogElement(inputRef.current), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const trimmed = branch.trim();
  return (
    <div className="modal-backdrop" onMouseDown={closeDialog}>
      <div
        className="modal compact-modal core-worktrees"
        role="dialog"
        aria-modal="true"
        aria-label={`Worktrees of ${room.label}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Worktrees · {room.label}</h2>
          <CloseButton onClick={closeDialog} />
        </div>
        <form
          className="core-worktrees-new"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || busy) return;
            setBusy(true);
            closeDialog();
            void createCoreWorktreeFor(room, trimmed);
          }}
        >
          <label className="form-field">
            <span>New worktree branch</span>
            <input
              ref={inputRef}
              value={branch}
              placeholder="feature-name"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setBranch(event.currentTarget.value)}
            />
          </label>
          <button type="submit" disabled={!trimmed || busy}>
            Create worktree
          </button>
        </form>
        <p className="modal-body-text core-worktrees-note">
          A new worktree starts from origin's default branch and becomes a room:
          agents started there work in it.
        </p>
        <section aria-label="Open a worktree" className="core-worktrees-list">
          <h3>Open a worktree</h3>
          {list.kind === "loading" ? (
            <p className="modal-body-text" role="status">
              Reading worktrees…
            </p>
          ) : list.kind === "error" ? (
            <p className="modal-body-text core-worktrees-error" role="alert">
              {list.message}
            </p>
          ) : list.entries.length === 0 ? (
            <p className="modal-body-text">
              This room's folder is not in a Git repository.
            </p>
          ) : (
            <ul>
              {list.entries.map((entry) => (
                <li key={entry.path}>
                  <span className="core-worktrees-entry">
                    <b>{entry.branch ?? "Detached HEAD"}</b>
                    <small title={entry.path}>{entry.path}</small>
                  </span>
                  <button
                    type="button"
                    disabled={entry.open || entry.prunable || busy}
                    title={
                      entry.open
                        ? "Already a room"
                        : entry.prunable
                          ? "Its folder is missing: prune it with Git"
                          : `Open ${entry.path} as a room`
                    }
                    onClick={() => {
                      setBusy(true);
                      closeDialog();
                      void openCoreWorktreeFor(room, entry);
                    }}
                  >
                    {entry.open
                      ? "In World"
                      : entry.prunable
                        ? "Missing"
                        : "Open"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="modal-actions">
          {room.linked ? (
            <button
              type="button"
              className="danger core-worktrees-remove"
              disabled={busy}
              onClick={() => {
                closeDialog();
                void removeCoreWorktreeConfirmed(room);
              }}
            >
              Remove this worktree…
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mounted once beside CoreKillConfirmHost. */
export function CoreWorktreesHost() {
  const room = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
  return room ? (
    <CoreWorktreeDialog key={JSON.stringify(room)} room={room} />
  ) : null;
}
