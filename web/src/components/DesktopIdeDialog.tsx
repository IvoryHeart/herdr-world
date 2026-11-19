import { useConnectionReady } from "../useConnectionClient";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useLayer } from "../layerStack";
import { trapDialogTab, focusDialogElement } from "./dialogFocus";
import {
  desktopIdeCall,
  desktopIdeFixture,
  desktopIdeTarget,
  dispatchDesktopIde,
  openInDesktopIde,
  parseDesktopIdes,
  type DesktopIdes,
  type DesktopIdeTarget,
} from "../desktopIdes";
import "./DesktopIdeDialog.css";

export function OpenInIdeButton({
  target,
  className,
}: {
  target: DesktopIdeTarget;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`desktop-ide-trigger ${className ?? ""}`}
      aria-label="Open in…"
      title="Open in a desktop IDE on the World host"
      onClick={() => openInDesktopIde(target)}
    >
      <ExternalLink size={14} aria-hidden="true" />
      <span>Open in…</span>
    </button>
  );
}
export function DesktopIdeHost() {
  const target = useSyncExternalStore(
    desktopIdeTarget.subscribe,
    desktopIdeTarget.get,
  );
  return target
    ? createPortal(
        <DesktopIdeDialog
          key={JSON.stringify([
            target.client.connectionId,
            target.client.serverRuntimeGeneration,
            target.workspaceId,
            target.path,
            target.client.agentWorktree,
          ])}
          target={target}
          onClose={() => openInDesktopIde(null)}
        />,
        document.body,
      )
    : null;
}
function DesktopIdeDialog({
  target,
  onClose,
}: {
  target: DesktopIdeTarget;
  onClose(): void;
}) {
  const ready = useConnectionReady(target.client);
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<DesktopIdes | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useLayer(true, onClose, { element: () => ref.current });
  useEffect(() => {
    const stopFocus = focusDialogElement(
      ref.current?.querySelector("button") ?? null,
    );
    const onKey = (event: KeyboardEvent) => trapDialogTab(event, ref.current);
    window.addEventListener("keydown", onKey);
    return () => {
      stopFocus();
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void desktopIdeCall("list")
      .then(parseDesktopIdes)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const open = async (ide: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await dispatchDesktopIde(target, ide);
      setMessage(
        `${result.label} handoff sent to the World host${desktopIdeFixture() ? " (preview only)" : ""}. Check its desktop for the IDE window.`,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sorted = [...(data?.ides ?? [])].sort(
    (a, b) =>
      Number(b.id === data?.default_id) - Number(a.id === data?.default_id),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal desktop-ide-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Open in desktop IDE"
      >
        <div className="desktop-ide-heading">
          <h2>Open in…</h2>
          <button
            type="button"
            aria-label="Refresh desktop IDEs"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <p>
          Opens on the computer running World, including when you use a phone.
          SSH projects use the IDE’s remote support.
        </p>
        <p className="desktop-ide-path">
          {target.path || target.label || "Project folder"}
        </p>
        {desktopIdeFixture() ? (
          <p role="status">
            Preview fixture — no IDE is launched or preference saved. Cursor
            demonstrates a launch failure; IntelliJ demonstrates an SSH refusal.
          </p>
        ) : null}
        {!ready ? (
          <p role="alert">
            This project host is unavailable. Refresh before opening it.
          </p>
        ) : target.client.agentWorktree === null ? (
          <p role="alert">
            Choose a current agent worktree before opening it in an IDE.
          </p>
        ) : null}
        {!data && !error ? <p role="status">Detecting desktop IDEs…</p> : null}
        <div className="desktop-ide-list">
          {sorted.map((ide) => (
            <button
              type="button"
              key={ide.id}
              disabled={
                busy ||
                !ide.installed ||
                !ready ||
                target.client.agentWorktree === null
              }
              onClick={() => void open(ide.id)}
            >
              <span>
                <strong>
                  {ide.label}
                  {data?.default_id === ide.id ? " · Default" : ""}
                </strong>
                <small>
                  {ide.installed
                    ? ide.ssh
                      ? "Local and SSH projects"
                      : "Local projects · SSH requires Gateway"
                    : ide.reason}
                </small>
              </span>
              <ExternalLink size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        {data && !data.ides.some((ide) => ide.installed) ? (
          <p>
            No desktop IDE found. Install an IDE and its command-line launcher
            on the World host, then refresh. Choose a default in Configuration →
            Integrations.
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
