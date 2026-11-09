/**
 * The command card for Town's group selection (#820). While agents are
 * chosen it takes the Town board sign's place, as a lens legend does, and on
 * a phone the summary chip reads "N selected" and opens it. Its orders act on
 * exactly the agents their labels count.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  townGroupCountsText,
  townOrderCount,
  townSendOutcomeText,
  type TownLeftOut,
} from "./townGroup";
import { useTownGroupContext, type TownGroup } from "./useTownGroup";
import "./townGroup.css";

/** The board sign's place: the command card while agents are chosen. */
export function TownGroupSign({ children }: { children: ReactNode }) {
  const group = useTownGroupContext();
  if (!group?.open) return children;
  return <TownGroupCard group={group} />;
}

function TownGroupCard({ group }: { group: TownGroup }) {
  // Phones show the chip; it opens the card in place, as the board's does.
  const [shown, setShown] = useState(false);
  const [notice, setNotice] = useState("");
  const { counts, orders } = group;
  const text = townGroupCountsText(counts);
  const review = orders.review.length;
  const message = orders.message.length;
  return (
    <>
      <button
        type="button"
        className="town-board-chip town-group-chip"
        aria-expanded={shown}
        aria-controls="town-group-card"
        aria-label={`${text}. ${shown ? "Hide" : "Show"} the orders`}
        onClick={() => setShown((value) => !value)}
      >
        {counts.selected} selected
      </button>
      <div
        id="town-group-card"
        className="town-board town-group-card"
        data-open={shown}
        data-composing={group.composing}
        role="group"
        aria-label="Selected agents"
      >
        <div className="town-board-title">
          SELECTED
          <button
            type="button"
            className="town-board-open"
            title="Clear the selection (Escape)"
            onClick={group.clear}
          >
            Clear
          </button>
        </div>
        <p className="town-group-counts" role="status">
          {text}
        </p>
        <div className="town-group-orders" role="group" aria-label="Orders">
          <button
            type="button"
            disabled={!review}
            title={
              review
                ? "Mark the finished work of each finished agent reviewed"
                : "No selected agent has finished work to review"
            }
            onClick={group.runReview}
          >
            Mark reviewed {townOrderCount(review, counts.selected)}
          </button>
          <button
            type="button"
            disabled={!message}
            aria-expanded={group.composing}
            onClick={() => {
              setNotice("");
              group.setComposing(!group.composing);
            }}
          >
            Send a message {townOrderCount(message, counts.selected)}
          </button>
          <button type="button" onClick={group.show}>
            Show them
          </button>
        </div>
        {group.composing ? (
          <TownGroupComposer
            recipients={message}
            notice={notice}
            onNotice={setNotice}
            onSend={group.send}
            onClose={() => group.setComposing(false)}
          />
        ) : null}
        {group.composing || group.sent ? (
          <TownLeftOutList members={orders.leftOut} />
        ) : null}
        {group.sent ? (
          <TownGroupResults
            title={group.testData ? "SENT · TEST DATA" : "SENT"}
            rows={group.sent.map((row) => ({
              key: row.key,
              label: row.label,
              text: townSendOutcomeText(row.outcome),
              status: row.outcome.status,
            }))}
          />
        ) : null}
        {group.review ? (
          <TownGroupResults
            title="MARK REVIEWED"
            rows={group.review.map((row) => ({
              key: row.key,
              label: row.label,
              text: row.outcome === "marking" ? "marking…" : row.outcome,
              status: row.outcome === "not saved" ? "refused" : row.outcome,
            }))}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * The group message's text box. Chat's composer is bound to one agent's pane
 * (its draft scope, uploads and slash-command menu), so a group message is
 * text only and goes through the same send path for each agent.
 */
function TownGroupComposer({
  recipients,
  notice,
  onNotice,
  onSend,
  onClose,
}: {
  recipients: number;
  notice: string;
  onNotice(notice: string): void;
  onSend(text: string): Promise<void>;
  onClose(): void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);
  const send = () => {
    if (sending) return;
    if (!text.trim()) {
      onNotice("Write a message first.");
      return;
    }
    setSending(true);
    onSend(text)
      .catch((cause: unknown) =>
        onNotice(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setSending(false));
  };
  const to = `${recipients} ${recipients === 1 ? "agent" : "agents"}`;
  return (
    <form
      className="town-group-compose"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        rows={3}
        value={text}
        aria-label={`Message to ${to}`}
        placeholder={`Message ${to}…`}
        onChange={(event) => {
          setText(event.target.value);
          onNotice("");
        }}
        onKeyDown={(event) => {
          // As in Chat: Ctrl+Enter or Cmd+Enter sends; Escape closes the
          // box and keeps the selection.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
      {notice ? (
        <p className="town-group-notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="town-group-compose-actions">
        <button type="button" className="town-group-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="town-group-send"
          disabled={sending}
          title="Send (Ctrl+Enter or Cmd+Enter)"
        >
          Send to {to}
        </button>
      </div>
    </form>
  );
}

function TownLeftOutList({
  members,
}: {
  members: readonly {
    key: string;
    label: string;
    leftOut: TownLeftOut | null;
  }[];
}) {
  if (!members.length) return null;
  return (
    <ul className="town-group-results" aria-label="Left out of the message">
      {members.map((member) => (
        <li key={member.key} data-status="left-out">
          <b>{member.label}</b> left out: {member.leftOut}
        </li>
      ))}
    </ul>
  );
}

function TownGroupResults({
  title,
  rows,
}: {
  title: string;
  rows: readonly { key: string; label: string; text: string; status: string }[];
}) {
  return (
    <div className="town-group-result">
      <span className="town-group-result-title">{title}</span>
      <ul className="town-group-results" aria-live="polite">
        {rows.map((row) => (
          <li key={row.key} data-status={row.status}>
            <b>{row.label}</b> {row.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Select on an agent's peek or a table's card: starts (or adds to) the
 * selection; while one is open a tap on the map adds or removes agents.
 */
export function TownGroupSelectButton({
  keys: agentKeys,
  deskKey,
}: {
  /** The agents to select; or */
  keys?: readonly string[];
  /** the table whose agents to select. */
  deskKey?: string;
}) {
  const group = useTownGroupContext();
  const keys =
    agentKeys ?? (deskKey !== undefined ? group?.deskAgents(deskKey) : []);
  if (!group || !keys?.length) return null;
  const chosen = keys.every((key) => group.keys.has(key));
  return (
    <button
      type="button"
      className="town-group-select"
      aria-pressed={chosen}
      title={
        chosen
          ? "Remove from the selection"
          : "Select, then tap more agents to give them one order"
      }
      onClick={(event) => {
        event.stopPropagation();
        group.toggle(keys);
      }}
    >
      {chosen ? "Selected" : "Select"}
    </button>
  );
}
