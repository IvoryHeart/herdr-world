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
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";

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
  const ready = snapshot.connections.filter(
    (connection) => connection.state === "ready",
  );
  const destinationSource = useRef({ ready, inherited, initialDestination });
  destinationSource.current = { ready, inherited, initialDestination };
  const current =
    destination &&
    ready.some(
      (connection) =>
        connection.id === destination.connectionId &&
        connection.generation === destination.runtimeGeneration,
    );
  const createReason = !current
    ? "Choose a current destination host."
    : endpointCreationReason(
        connectionSnapshot(snapshot, destination!.connectionId),
        "workspace.create",
        destination!.connectionId === initialDestination?.connectionId &&
          destination!.runtimeGeneration ===
            initialDestination.runtimeGeneration
          ? initialDestination.sourceWorkspaceId
          : undefined,
      );
  const [label, setLabel] = useState("");
  const [cwd, setCwd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionPending = useRef(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

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

  useEffect(() => {
    if (!open) return;
    setLabel(initialName?.trim() || luckyWorkspaceName());
    setCwd(initialCwd?.trim() ?? "");
    const cancelFocus = focusDialogElement(labelRef.current, { select: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, initialName, initialCwd]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionPending.current || createReason) return;
    if (!destination) return;
    submissionPending.current = true;
    setSubmitting(true);
    try {
      await store.createQualifiedWorkspace(
        destination,
        label.trim() || undefined,
        cwd.trim() || undefined,
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
            value={destination?.connectionId ?? ""}
            onChange={(event) => {
              const owner = ready.find(
                (connection) => connection.id === event.target.value,
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
            {ready.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Name</span>
          <input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder="Optional"
          />
        </label>

        <label className="form-field">
          <span>CWD</span>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.currentTarget.value)}
            placeholder="Optional path"
          />
        </label>

        {createReason ? <p role="status">{createReason}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !!createReason}
            title={createReason ?? undefined}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
