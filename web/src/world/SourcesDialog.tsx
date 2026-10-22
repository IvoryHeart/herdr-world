import { CircleCheck, CircleOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorldSourceStatus } from "../../../shared/worldSources";
import { CloseButton } from "../components/CloseButton";
import { focusDialogElement } from "../components/dialogFocus";
import {
  updateWorldSource,
  useWorldSources,
  worldSourcesStore,
} from "./worldSources";

/**
 * Sources settings: each built-in source with its state, an on/off switch and
 * its own fields. Jira's API token is write-only; the service keeps it.
 */
export function SourcesDialog({ onClose }: { onClose(): void }) {
  const snapshot = useWorldSources();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [jira, setJira] = useState({ site: "", email: "", jql: "", token: "" });
  const [jiraLoaded, setJiraLoaded] = useState(false);

  const jiraStatus = snapshot.sources.find((source) => source.id === "jira");
  useEffect(() => {
    if (jiraLoaded || jiraStatus?.config.kind !== "jira") return;
    setJira({
      site: jiraStatus.config.site?.replace(/^https:\/\//u, "") ?? "",
      email: jiraStatus.config.email ?? "",
      jql: jiraStatus.config.jql,
      token: "",
    });
    setJiraLoaded(true);
  }, [jiraLoaded, jiraStatus]);

  useEffect(() => {
    const cancelFocus = focusDialogElement(dialogRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    void worldSourcesStore.refresh();
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const run = async (
    label: string,
    task: () => Promise<unknown>,
    done: string,
  ) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await task();
      setMessage(done);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not save source settings",
      );
    } finally {
      setBusy(null);
    }
  };

  const toggle = (source: WorldSourceStatus) =>
    void run(
      source.id,
      () => updateWorldSource(source.id, { enabled: !source.enabled }),
      `${source.label} ${source.enabled ? "switched off" : "switched on"}.`,
    );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal compact-modal world-sources-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Sources"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Sources</h2>
          <CloseButton onClick={onClose} label="Close sources" />
        </div>
        <p className="world-observability-help">
          World shows your pull requests and tickets beside your agents: on
          Board's Work lens and as badges on Town desks. The World service makes
          the requests with your sign-ins; the browser never contacts GitHub or
          Jira.
        </p>

        {snapshot.sources.length ? null : (
          <p className="world-observability-field-help">Loading sources…</p>
        )}
        {snapshot.sources.map((source) => (
          <section
            key={source.id}
            className="world-source"
            aria-label={source.label}
          >
            <div className="world-source-head">
              <h3>{source.label}</h3>
              <button
                type="button"
                role="switch"
                aria-checked={source.enabled}
                aria-label={`${source.label} source`}
                className="world-source-switch"
                disabled={busy !== null}
                onClick={() => toggle(source)}
              >
                <span />
              </button>
            </div>
            <div
              className="world-observability-health"
              data-status={
                source.state === "connected"
                  ? "available"
                  : source.state === "error"
                    ? "degraded"
                    : "unavailable"
              }
              role="status"
            >
              {source.state === "connected" ? (
                <CircleCheck size={15} aria-hidden="true" />
              ) : source.state === "error" ? (
                <TriangleAlert size={15} aria-hidden="true" />
              ) : (
                <CircleOff size={15} aria-hidden="true" />
              )}
              <span>{source.detail}</span>
            </div>
            {source.id === "github" && source.enabled ? (
              <p className="world-observability-field-help">
                Uses the GitHub CLI signed in as the user that runs World: pull
                requests you opened, were asked to review or are assigned, the
                last week's merged ones and issues assigned to you. Each agent's
                desk shows the pull request for its branch.
              </p>
            ) : null}
            {source.id === "jira" && source.enabled ? (
              <form
                className="world-source-fields"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    "jira",
                    async () => {
                      await updateWorldSource("jira", {
                        site: jira.site,
                        email: jira.email,
                        jql: jira.jql,
                        ...(jira.token ? { token: jira.token } : {}),
                      });
                      setJira((value) => ({ ...value, token: "" }));
                    },
                    "Jira settings saved.",
                  );
                }}
              >
                <label className="form-field">
                  <span>Site</span>
                  <input
                    value={jira.site}
                    placeholder="example.atlassian.net"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      const site = event.currentTarget.value;
                      setJira((value) => ({ ...value, site }));
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Account email</span>
                  <input
                    type="email"
                    value={jira.email}
                    placeholder="you@example.com"
                    autoComplete="off"
                    onChange={(event) => {
                      const email = event.currentTarget.value;
                      setJira((value) => ({ ...value, email }));
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>API token</span>
                  <input
                    type="password"
                    value={jira.token}
                    placeholder={
                      source.config.kind === "jira" && source.config.tokenSet
                        ? "Saved; type to replace"
                        : "From id.atlassian.com, Security, API tokens"
                    }
                    autoComplete="new-password"
                    onChange={(event) => {
                      const token = event.currentTarget.value;
                      setJira((value) => ({ ...value, token }));
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Filter (JQL)</span>
                  <textarea
                    rows={3}
                    value={jira.jql}
                    spellCheck={false}
                    onChange={(event) => {
                      const jql = event.currentTarget.value;
                      setJira((value) => ({ ...value, jql }));
                    }}
                  />
                </label>
                <p className="world-observability-field-help">
                  Leave the filter empty for tickets assigned to you or that you
                  watch. The token is kept in World's private storage on the
                  service and is never shown again.
                </p>
                <div className="modal-actions world-observability-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={
                      busy !== null ||
                      !(source.config.kind === "jira" && source.config.tokenSet)
                    }
                    onClick={() =>
                      void run(
                        "jira",
                        () => updateWorldSource("jira", { token: null }),
                        "Jira API token removed.",
                      )
                    }
                  >
                    Remove token
                  </button>
                  <button type="submit" disabled={busy !== null}>
                    {busy === "jira" ? "Saving…" : "Save Jira"}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        ))}

        {error ? (
          <p className="modal-error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p className="modal-message">{message}</p> : null}
        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "refresh",
                () => worldSourcesStore.refresh(true),
                "Sources refreshed.",
              )
            }
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh now
          </button>
        </div>
      </div>
    </div>
  );
}
