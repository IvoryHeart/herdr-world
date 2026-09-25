import { useEffect, useRef, useState } from "react";
import type { ConnectionClient } from "../api";
type Context =
  | { available: false; reason: string }
  | {
      available: true;
      checkout_path: string;
      branch: string | null;
      worktree: string;
      changed_files: Array<{ path: string; status: string }>;
      changed_count: number;
      truncated: boolean;
      reported_pr?: string;
    };
function unavailable(reason: string): Context {
  return { available: false, reason };
}
function isContext(value: unknown): value is Context {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { available?: unknown }).available === "boolean" &&
    (!(value as { available: boolean }).available ||
      (typeof (value as { checkout_path?: unknown }).checkout_path ===
        "string" &&
        Array.isArray((value as { changed_files?: unknown }).changed_files)))
  );
}
export function AgentCheckoutPanel({
  paneId,
  sessionFingerprint,
  client,
  onWorkspaceChanges,
}: {
  paneId?: string;
  sessionFingerprint?: string;
  client: ConnectionClient;
  onWorkspaceChanges(): void;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const current = request.current + 1;
    request.current = current;
    setContext(null);
    if (!paneId || !sessionFingerprint) {
      setContext(
        unavailable(
          "Agent checkout unavailable: this agent has no current session metadata.",
        ),
      );
      return;
    }
    void client
      .call("agent_checkout.get", {
        pane_id: paneId,
        agent_session_fingerprint: sessionFingerprint,
      })
      .then((next) => {
        if (client.isCurrent() && request.current === current)
          setContext(
            isContext(next)
              ? next
              : unavailable("Agent checkout unavailable: context was invalid."),
          );
      })
      .catch(() => {
        if (client.isCurrent() && request.current === current)
          setContext(
            unavailable(
              "Agent checkout unavailable: context could not be read.",
            ),
          );
      });
    return () => {
      request.current += 1;
    };
  }, [client, paneId, sessionFingerprint]);
  if (!context)
    return (
      <div className="agent-checkout-panel" role="status">
        Loading Agent checkout…
      </div>
    );
  if (!context.available)
    return (
      <div className="agent-checkout-panel">
        <strong>Agent checkout unavailable</strong>
        <span>
          {context.reason.replace(/^Agent checkout unavailable:\s*/u, "")}
        </span>
        <button type="button" onClick={onWorkspaceChanges}>
          Workspace changes
        </button>
      </div>
    );
  return (
    <div className="agent-checkout-panel">
      <div className="agent-checkout-heading">
        <strong>Agent checkout</strong>
        <button type="button" onClick={onWorkspaceChanges}>
          Workspace changes
        </button>
      </div>
      <code>{context.checkout_path}</code>
      <span>
        {context.branch ?? "Detached HEAD"} · {context.worktree} worktree ·{" "}
        {context.changed_count} changed
      </span>
      {context.reported_pr ? (
        <a href={context.reported_pr} target="_blank" rel="noreferrer">
          Reported PR
        </a>
      ) : null}
      <div className="agent-checkout-files" role="list">
        {context.changed_files.map((file) => (
          <div key={`${file.status}:${file.path}`} role="listitem">
            <code>{file.status}</code>
            <span>{file.path}</span>
          </div>
        ))}
        {context.truncated ? (
          <span>Additional changed files are not shown.</span>
        ) : null}
      </div>
    </div>
  );
}
