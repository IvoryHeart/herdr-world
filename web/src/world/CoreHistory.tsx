import { useEffect, useState } from "react";
import type {
  CoreHistory as History,
  CoreHistorySession,
} from "../../../shared/coreHistory";
import { bridge } from "../api";
import { MarkdownPreview } from "../components/markdown";
import { coreRecipient } from "./coreDelivery";
import type { WorldLeafObject } from "./worldObject";

/** Transcript reading is independent of native input authority. A linked
 * session belongs only to this open Chat; closing it forgets the link. */
export function CoreHistory({
  recipient,
  leaf,
}: {
  recipient: WorldLeafObject;
  leaf: WorldLeafObject;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [session, setSession] = useState<CoreHistorySession>();
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"id" | "path">("id");
  const changed =
    recipient.pane.core_recipient !== leaf.pane.core_recipient ||
    recipient.generation !== leaf.generation;
  const turn = leaf.pane.turn;
  useEffect(() => {
    let current = true;
    setLoading(false);
    setHistory(null);
    setError("");
    const to = coreRecipient(recipient);
    if (!to || changed || leaf.stale) return;
    setLoading(true);
    void bridge
      .call(
        "world.core.history",
        { ...to, ...(session ? { session } : {}) },
        90_000,
      )
      .then((result) => {
        if (current) setHistory(result as History);
      })
      .catch((cause) => {
        if (current)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [recipient, changed, leaf.stale, leaf.status, turn, revision, session]);
  if (changed)
    return <p>The agent changed. Reopen Chat to read its conversation.</p>;
  return (
    <section className="core-history" aria-label="Conversation history">
      <div className="core-history-controls">
        <strong>Conversation</strong>
        <button
          type="button"
          disabled={loading || leaf.stale}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh conversation
        </button>
      </div>
      {loading ? <p>Reading conversation…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {history ? (
        <>
          <p>{history.detail}</p>
          {history.source ? (
            <p>
              {history.source === "linked"
                ? "Linked for reading only."
                : history.source === "discovered"
                  ? "Found by directory; this may be another conversation."
                  : "Identified by the agent’s title or launch arguments."}
            </p>
          ) : null}
          {history.entries.length ? (
            <ol className="core-history-entries">
              {history.entries.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {entry.notice ||
                      entry.tool_name ||
                      (entry.role === "user"
                        ? "You"
                        : entry.role === "assistant"
                          ? "Agent"
                          : "Tool")}
                  </strong>
                  {entry.kind === "message" ? (
                    <MarkdownPreview text={entry.text} />
                  ) : (
                    <details>
                      <summary>
                        {entry.kind === "tool_call" ? "Arguments" : "Output"}
                      </summary>
                      <pre>{entry.text}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          ) : history.status === "ok" ? (
            <p>No messages yet.</p>
          ) : null}
          {history.truncated ? (
            <p>
              Long entries are shortened here. Read the transcript for their
              full contents.
            </p>
          ) : null}
        </>
      ) : null}
      <details>
        <summary>Link a conversation for reading</summary>
        <p>
          Use a session ID or an absolute transcript path on this agent’s host.
          This changes only what you read; messages still go to the agent you
          opened.
        </p>
        <label>
          Session reference
          <select
            aria-label="Session reference"
            value={kind}
            onChange={(event) =>
              setKind(event.currentTarget.value as "id" | "path")
            }
          >
            <option value="id">Session ID</option>
            <option value="path">Transcript path</option>
          </select>
        </label>
        <label>
          Session ID or path
          <input
            aria-label="Session ID or path"
            value={value}
            maxLength={4096}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={!value.trim() || loading || leaf.stale}
          onClick={() => setSession({ kind, value: value.trim() })}
        >
          Read linked conversation
        </button>
        {session ? (
          <button
            type="button"
            onClick={() => {
              setSession(undefined);
              setValue("");
            }}
          >
            Remove link
          </button>
        ) : null}
      </details>
    </section>
  );
}
