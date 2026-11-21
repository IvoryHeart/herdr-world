import { useEffectCallback } from "../useEffectCallback";
import {
  useCreationProgress,
  creationFailureMessage,
} from "../creationRequests";
import { useContext, useEffect, useRef, useState } from "react";
import { luckyWorkspaceName } from "../luckyName";
import {
  OperationalContext,
  store,
  connectionSnapshot,
  endpointCreationReason,
  useStoreSelector,
} from "../store";
import { useId, useMemo } from "react";
import { CornerLeftUp, Folder, History } from "lucide-react";
import type { WorkspacePathInfo } from "../../../shared/workspacePath";
import { bridge, type ConnectionClient } from "../api";
import { worldHosts, type WorldHost } from "../worldHosts";
import { primaryRuntime, runtimeName, worldHostGroups } from "../hostGroups";
import { createCoreRoom } from "../world/coreControl";
import {
  completeFolder,
  parentFolder,
  useRecentFolders,
} from "../world/recentFolders";
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";
import { useSuggestedName } from "./useSuggestedName";
import "./CreateWorkspaceDialog.css";

/**
 * New room (a Herdr workspace) on a chosen host. Every host of `worldHosts`
 * can take one: a herdr-core host gets a room of World's layout there. The
 * folder starts at the host's most recent one (else home): its other recent
 * folders are one tap away, the folders inside it a list to browse, and a
 * typed path completes with Tab (#1006).
 */
export function CreateWorkspaceDialog({
  open,
  initialName,
  initialCwd,
  initialDestination,
  onClose,
}: {
  open: boolean;
  initialName?: string;
  initialCwd?: string;
  initialDestination?: {
    connectionId: string;
    runtimeGeneration: number;
    sourceWorkspaceId?: string;
  };
  onClose: () => void;
}) {
  useCreationProgress();
  const inherited = useContext(OperationalContext);
  const snapshot = useStoreSelector((state) => state);
  const [destination, setDestination] = useState<{
    connectionId: string;
    runtimeGeneration: number;
  } | null>(null);
  const hosts = useStoreSelector(worldHosts);
  const ready = hosts.filter((host) => host.state === "ready");
  // The picker names machines; each option stands for its host's first
  // ready runtime, and a Runtime choice appears only where a host has more.
  const groups = useStoreSelector(worldHostGroups);
  const readyHosts = groups
    .map((group) => ({
      ...group,
      ready: group.runtimes.filter((runtime) => runtime.state === "ready"),
    }))
    .filter((group) => group.ready.length);
  const destinationSource = useRef({ ready, inherited, initialDestination });
  destinationSource.current = { ready, inherited, initialDestination };
  const current: WorldHost | null =
    (destination &&
      ready.find(
        (host) =>
          host.id === destination.connectionId &&
          host.generation === destination.runtimeGeneration,
      )) ||
    null;
  const currentHost = current
    ? readyHosts.find((group) =>
        group.ready.some((runtime) => runtime.id === current.id),
      )
    : undefined;
  const inCore = current?.runtime === "herdr-core";
  const createReason = !current
    ? "Choose a current destination host."
    : inCore
      ? null
      : endpointCreationReason(
          connectionSnapshot(snapshot, destination!.connectionId),
          "workspace.create",
          destination!.connectionId === initialDestination?.connectionId &&
            destination!.runtimeGeneration ===
              initialDestination.runtimeGeneration
            ? initialDestination.sourceWorkspaceId
            : undefined,
        );
  const labelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel, namePending] = useSuggestedName(
    open,
    initialName?.trim() || luckyWorkspaceName,
    labelRef,
  );
  const [cwd, setCwd] = useState("");
  // Until the person edits the folder, it follows the host's default.
  const [cwdTouched, setCwdTouched] = useState(false);
  const recent = useRecentFolders(current?.id ?? null);
  const suggestedCwd = initialCwd?.trim() || recent[0] || "~";
  const [submitting, setSubmitting] = useState(false);
  const submissionPending = useRef(false);
  const onCloseEvent = useEffectCallback(onClose);

  useEffect(() => {
    if (!open) return;
    const { ready, inherited, initialDestination } = destinationSource.current;
    if (initialDestination) {
      setDestination(initialDestination);
      return;
    }
    const owner =
      ready.find((connection) => connection.id === inherited?.connectionId) ??
      ready[0];
    setDestination(
      owner
        ? { connectionId: owner.id, runtimeGeneration: owner.generation }
        : null,
    );
  }, [open]);
  const client = useMemo(
    () =>
      destination
        ? bridge.connection(
            destination.connectionId,
            destination.runtimeGeneration,
          )
        : null,
    [
      destination?.connectionId,
      destination?.runtimeGeneration,
      snapshot.connectionGeneration,
      snapshot.status,
      snapshot.terminalAttachEpoch,
    ],
  );
  const [pathState, setPathState] = useState<{
    client: ConnectionClient;
    input: string;
    info?: WorkspacePathInfo;
    error?: string;
  } | null>(null);
  const [createError, setCreateError] = useState("");
  const cwdRef = useRef<HTMLInputElement>(null);
  const pathHintId = useId();
  const cwdId = useId();

  useEffect(() => {
    if (!open) return;
    setCwdTouched(false);
    const cancelFocus = focusDialogElement(labelRef.current, { select: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseEvent();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, initialName, initialCwd, onCloseEvent]);

  useEffect(() => {
    if (open && !cwdTouched) setCwd(suggestedCwd);
  }, [open, cwdTouched, suggestedCwd]);

  useEffect(() => {
    setCreateError("");
    setPathState(null);
  }, [open, client]);

  const input = cwd.trim();
  useEffect(() => {
    if (!open || !input || !client) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void client.call("workspace.path", { path: input }).then(
        (info: WorkspacePathInfo) => {
          if (!cancelled && client.isCurrent())
            setPathState(
              typeof info?.path === "string"
                ? {
                    client,
                    input,
                    info: {
                      ...info,
                      directories: Array.isArray(info.directories)
                        ? info.directories
                        : [],
                    },
                  }
                : // An answer without a folder checks nothing.
                  { client, input },
            );
        },
        (error: Error) => {
          if (!cancelled && client.isCurrent())
            setPathState({ client, input, error: error.message });
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, client, input]);

  if (!open) return null;

  const checked =
    pathState && pathState.client === client && pathState.input === input
      ? pathState
      : null;
  const pathError = checked?.error || checked?.info?.error;
  const unchecked = !!input && !checked;
  // World's own default (a folder seen on this host, or home) need not wait
  // for its check: a quick Create still lands there. A folder the caller
  // asked for is checked first, as a typed one is.
  const offered = !cwdTouched && !initialCwd?.trim() && input === suggestedCwd;
  const checking = unchecked && !offered;
  const folder = !input
    ? undefined
    : (checked?.info?.path ?? (offered && input !== "~" ? input : undefined));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      namePending ||
      submissionPending.current ||
      createReason ||
      checking ||
      pathError ||
      ((!inCore || input) && !client?.isCurrent())
    )
      return;
    if (!destination) return;
    submissionPending.current = true;
    setSubmitting(true);
    setCreateError("");
    try {
      if (inCore) {
        await createCoreRoom(
          {
            connectionId: destination.connectionId,
            generation: destination.runtimeGeneration,
          },
          // An empty name is the service's "Room": never unnamed.
          label.trim(),
          folder,
        );
        onClose();
        return;
      }
      await store.createQualifiedWorkspace(
        destination,
        label.trim() || undefined,
        folder,
        {
          sourceWorkspaceId:
            destination.connectionId === initialDestination?.connectionId &&
            destination.runtimeGeneration ===
              initialDestination.runtimeGeneration
              ? initialDestination.sourceWorkspaceId
              : undefined,
        },
      );
      onClose();
    } catch (error) {
      setCreateError(creationFailureMessage(error, "Workspace"));
      store.notify({
        kind: "error",
        message: creationFailureMessage(error, "Workspace"),
        detail: String(error),
      });
    } finally {
      submissionPending.current = false;
      setSubmitting(false);
    }
  };

  const chooseFolder = (folder: string) => {
    setCwdTouched(true);
    setCwd(folder);
    setCreateError("");
    cwdRef.current?.focus();
  };
  // Up from an existing folder; from a typed prefix, its folder is listed.
  const up =
    checked?.info && !checked.info.error
      ? parentFolder(checked.info.path)
      : null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create workspace"
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Create Workspace</h2>
          <CloseButton onClick={onClose} />
        </div>

        <label className="form-field">
          <span>Destination host</span>
          <select
            aria-label="Destination host"
            disabled={submitting}
            value={currentHost?.ready[0]!.id ?? ""}
            onChange={(event) => {
              const host = readyHosts.find(
                (group) => group.ready[0]!.id === event.target.value,
              );
              const owner =
                host &&
                primaryRuntime(
                  { runtimes: host.ready },
                  inherited?.connectionId,
                );
              setDestination(
                owner
                  ? {
                      connectionId: owner.id,
                      runtimeGeneration: owner.generation,
                    }
                  : null,
              );
            }}
          >
            <option value="" disabled>
              Choose a host
            </option>
            {readyHosts.map((host) => (
              <option key={host.id} value={host.ready[0]!.id}>
                {host.label}
              </option>
            ))}
          </select>
        </label>
        {currentHost && currentHost.ready.length > 1 ? (
          <label className="form-field">
            <span>Runtime</span>
            <select
              aria-label="Runtime"
              disabled={submitting}
              value={destination?.connectionId ?? ""}
              onChange={(event) => {
                const owner = currentHost.ready.find(
                  (runtime) => runtime.id === event.target.value,
                );
                if (owner)
                  setDestination({
                    connectionId: owner.id,
                    runtimeGeneration: owner.generation,
                  });
              }}
            >
              {currentHost.ready.map((runtime) => (
                <option key={runtime.id} value={runtime.id}>
                  {runtimeName(runtime)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="form-field">
          <span>Name</span>
          <input
            ref={labelRef}
            value={label}
            disabled={submitting}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder="Optional"
          />
        </label>

        <div className="form-field">
          <label htmlFor={cwdId}>Folder</label>
          {recent.length ? (
            <div
              className="workspace-recent-folders"
              role="group"
              aria-label="Recent folders"
            >
              <History size={14} aria-hidden="true" />
              {recent.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  className="ghost"
                  aria-pressed={folder === input}
                  disabled={submitting}
                  title={folder}
                  onClick={() => chooseFolder(folder)}
                >
                  {folderName(folder)}
                </button>
              ))}
            </div>
          ) : null}
          <input
            id={cwdId}
            ref={cwdRef}
            value={cwd}
            onChange={(e) => {
              setCwdTouched(true);
              setCwd(e.currentTarget.value);
              setCreateError("");
            }}
            onKeyDown={(e) => {
              // Tab completes a typed folder, as a shell does.
              if (e.key !== "Tab" || e.shiftKey || !checked?.info) return;
              const completed = completeFolder(
                checked.info.path,
                checked.info.directories,
              );
              if (!completed) return;
              e.preventDefault();
              chooseFolder(completed);
            }}
            placeholder="e.g. ~/Developer/project"
            spellCheck={false}
            autoComplete="off"
            disabled={submitting}
            aria-invalid={!!pathError}
            aria-describedby={pathHintId}
          />
        </div>
        <div id={pathHintId} className="workspace-path-hint" aria-live="polite">
          {unchecked ? (
            <p role="status">Checking folder...</p>
          ) : pathError ? (
            <p className="modal-error" role="alert">
              {pathError}
            </p>
          ) : checked?.info ? (
            <p>
              Folder: <code>{checked.info.path}</code>
            </p>
          ) : (
            <p>
              Use an absolute path or ~/ on that host; Tab completes it. Leave
              blank for the host&apos;s default folder.
            </p>
          )}
        </div>
        {checked?.info && (up || checked.info.directories.length) ? (
          <div
            className="workspace-path-directories"
            role="list"
            aria-label="Folders to browse"
          >
            {up ? (
              <div role="listitem">
                <button
                  type="button"
                  className="ghost"
                  disabled={submitting}
                  title={up}
                  data-folder-up=""
                  onClick={() => chooseFolder(up)}
                >
                  <CornerLeftUp size={14} aria-hidden="true" />
                  <span>Up to {folderName(up)}</span>
                </button>
              </div>
            ) : null}
            {checked.info.directories.map((directory) => (
              <div key={directory} role="listitem">
                <button
                  type="button"
                  className="ghost"
                  disabled={submitting}
                  title={directory}
                  onClick={() =>
                    chooseFolder(
                      directory.endsWith("/") ? directory : `${directory}/`,
                    )
                  }
                >
                  <Folder size={14} aria-hidden="true" />
                  <span>{folderName(directory)}/</span>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {createError ? (
          <p className="modal-error" role="alert">
            {createError}
          </p>
        ) : null}
        {createReason ? <p role="status">{createReason}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              namePending ||
              submitting ||
              !!createReason ||
              checking ||
              !!pathError
            }
            title={createReason ?? undefined}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A folder's last name, for a button; the full path is its title. */
function folderName(folder: string) {
  return (
    folder
      .split(folder.startsWith("/") ? "/" : /[/\\]/)
      .filter(Boolean)
      .pop() ?? folder
  );
}
