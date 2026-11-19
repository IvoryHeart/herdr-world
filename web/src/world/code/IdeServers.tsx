import { useState } from "react";
import { Square } from "lucide-react";
import { ConfirmDialog } from "../../components/ModalDialogs";
import { displayFolder } from "./codeProjects";
import type { IdeInstance, IdeProviderStatus, IdeStatus } from "./ideClient";
import "./IdeProviders.css";

/**
 * The IDE servers World started that still run, wherever World is attached
 * or not: after a restart, a reconnect or a dropped SSH link they run on
 * their host until someone stops them. Failed ones no longer run.
 */
export const runningIdeServers = (status: IdeStatus | null) =>
  (status?.instances ?? []).filter((instance) => instance.state !== "failed");

/** Where a server runs: its SSH host, else World's own computer. */
export const ideServerHost = (instance: IdeInstance) =>
  instance.sshDestination ?? "this computer";

export function ideProviderLabel(
  providers: IdeProviderStatus[],
  instance: IdeInstance,
) {
  return (
    providers.find((candidate) => candidate.id === instance.provider)?.label ??
    "IDE"
  );
}

/** Said before Stop: everything inside it ends with it. */
export const ideStopEnds = (count = 1) =>
  count === 1
    ? "Everything running in it ends with it: its terminals, tasks, debug sessions and extensions. Agents and World's own terminals keep running."
    : "Everything running in them ends with them: their terminals, tasks, debug sessions and extensions. Agents and World's own terminals keep running.";

/** Since-when, short: the time today, else the date and time. */
export function ideSince(startedAt: string, now = new Date()) {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(undefined, { timeStyle: "short" })
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

const STATE_LABELS: Record<IdeInstance["state"], string> = {
  ready: "Open in World",
  starting: "Starting",
  detached: "Running, not attached",
  failed: "Stopped",
};

/**
 * Every IDE server World started that still runs, per host and folder, with
 * since-when and Stop. Stop asks first, saying what ends with it.
 */
export function IdeServerList({
  status,
  hostLabel = ideServerHost,
  onStop,
  onShow,
}: {
  status: IdeStatus;
  /** The host's name as the caller shows it. */
  hostLabel?: (instance: IdeInstance) => string;
  onStop: (instance: IdeInstance) => Promise<unknown> | unknown;
  /** Brings its project to the front, where the caller can. */
  onShow?: (instance: IdeInstance) => void;
}) {
  const [confirm, setConfirm] = useState<IdeInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const servers = runningIdeServers(status);
  const stop = async (instance: IdeInstance) => {
    setError(null);
    try {
      await onStop(instance);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="ide-servers">
      {servers.length ? (
        <ul className="ide-server-list" aria-label="Running IDE servers">
          {servers.map((instance) => {
            const since = ideSince(instance.startedAt);
            return (
              <li
                key={instance.id}
                className="ide-server"
                data-state={instance.state}
              >
                <div className="ide-server-what">
                  <strong title={instance.folder}>
                    {displayFolder(instance.folder)}
                  </strong>
                  <span>
                    {ideProviderLabel(status.providers, instance)} on{" "}
                    {hostLabel(instance)}
                    {since ? ` · since ${since}` : ""}
                  </span>
                  <span className="ide-server-state">
                    {instance.stopping
                      ? "Stopping…"
                      : STATE_LABELS[instance.state]}
                  </span>
                  {instance.reason && instance.state === "detached" ? (
                    <span className="ide-server-reason">{instance.reason}</span>
                  ) : null}
                </div>
                <div className="ide-provider-actions">
                  {onShow ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onShow(instance)}
                    >
                      Show
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={instance.stopping}
                    aria-label={`Stop the IDE for ${displayFolder(instance.folder)}`}
                    onClick={() => setConfirm(instance)}
                  >
                    <Square size={12} aria-hidden /> Stop…
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ide-provider-reason">No IDE servers are running.</p>
      )}
      {error ? (
        <p className="ide-providers-error" role="alert">
          {error}
        </p>
      ) : null}
      <IdeStopDialog
        instance={confirm}
        providers={status.providers}
        hostLabel={hostLabel}
        onClose={() => setConfirm(null)}
        onStop={stop}
      />
    </div>
  );
}

/** The one Stop confirmation, in the Code view's bar and in the lists. */
export function IdeStopDialog({
  instance,
  providers,
  hostLabel = ideServerHost,
  onClose,
  onStop,
}: {
  instance: IdeInstance | null;
  providers: IdeProviderStatus[];
  hostLabel?: (instance: IdeInstance) => string;
  onClose: () => void;
  onStop: (instance: IdeInstance) => Promise<unknown> | unknown;
}) {
  return (
    <ConfirmDialog
      open={instance !== null}
      title="Stop the IDE server"
      message={
        instance
          ? `Stop ${ideProviderLabel(providers, instance)} for ${displayFolder(instance.folder)} on ${hostLabel(instance)}? ${ideStopEnds()}`
          : ""
      }
      confirmLabel="Stop"
      danger
      onClose={onClose}
      onConfirm={() => {
        if (instance) void onStop(instance);
      }}
    />
  );
}
