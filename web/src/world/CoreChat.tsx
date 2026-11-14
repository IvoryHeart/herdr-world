import { type ReactNode, useRef, useState } from "react";
import { CoreHistory } from "./CoreHistory";
import type { WorldLeafObject, WorldObjectNode } from "./worldObject";
import {
  coreDeliveryText,
  pressForCoreAgent,
  readCoreAgentScreen,
  sendToCoreAgent,
} from "./coreDelivery";
import "./CoreChat.css";

/** Core input keeps the recipient shown on opening, even as live rows change. */
export function CoreChat({
  leaf,
  compact = false,
  onOpenTerminal,
}: {
  leaf: WorldLeafObject;
  compact?: boolean;
  /** Opens the agent's terminal in its own window, watched until you type. */
  onOpenTerminal?(): void;
}) {
  const [recipient] = useState(leaf);
  const name = recipient.agentName || recipient.label;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [screen, setScreen] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const waiting = leaf.status === "blocked";
  const perform = async (key?: string) => {
    if (inFlight.current || (!key && !text.trim())) return;
    inFlight.current = true;
    setBusy(true);
    const input = text.trim();
    setText("");
    try {
      const result = key
        ? await pressForCoreAgent(recipient, key)
        : await sendToCoreAgent(recipient, input, waiting);
      setNotice(coreDeliveryText(result, name));
      if (!key && result.status === "refused") setText(input);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="core-chat" aria-label={`Chat with ${name}`}>
      {!compact ? <CoreHistory recipient={recipient} leaf={leaf} /> : null}
      {leaf.pane.status_message ? (
        <p className="core-chat-question">{leaf.pane.status_message}</p>
      ) : null}
      {waiting && !compact ? (
        <>
          <button
            type="button"
            disabled={reading}
            onClick={() => {
              setReading(true);
              void readCoreAgentScreen(recipient)
                .then(setScreen)
                .catch(() =>
                  setNotice("World could not read the question screen."),
                )
                .finally(() => setReading(false));
            }}
          >
            Read question screen
          </button>
          {screen !== null ? (
            <pre aria-label="Question terminal screen">{screen}</pre>
          ) : null}
        </>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform();
        }}
      >
        <label>
          {waiting ? `Your answer to ${name}` : `Message to ${name}`}
          <textarea
            aria-label={
              waiting ? `Your answer to ${name}` : `Message to ${name}`
            }
            maxLength={16000}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            disabled={busy || leaf.stale}
            rows={compact ? 2 : 4}
          />
        </label>
        <button type="submit" disabled={busy || leaf.stale || !text.trim()}>
          {busy ? "Sending…" : waiting ? "Answer" : "Send"}
        </button>
        {waiting ? (
          <div className="core-chat-keys" aria-label="Answer keys">
            {["up", "down", "enter", "esc", "y", "n"].map((key) => (
              <button
                type="button"
                key={key}
                disabled={busy || leaf.stale}
                onClick={() => void perform(key)}
              >
                {key}
              </button>
            ))}
          </div>
        ) : null}
      </form>
      {notice ? <p role="status">{notice}</p> : null}
      {onOpenTerminal ? (
        <button
          type="button"
          className="core-chat-terminal"
          onClick={onOpenTerminal}
        >
          Watch terminal
        </button>
      ) : null}
    </section>
  );
}

/**
 * A herdr-core agent's Chat for its Inspector: core's own input and history,
 * beside Files and Changes, with its terminal a tap away in its own window.
 * Other nodes read Chat through Herdr, so they have none here.
 */
export function coreAgentChat(
  node: WorldObjectNode | undefined,
  onOpenTerminal: (id: string) => void,
): ReactNode | undefined {
  if (node?.kind !== "agent" || node.pane.runtime !== "herdr-core") return;
  return (
    <CoreChat
      key={`${node.id}:${node.generation}`}
      leaf={node}
      onOpenTerminal={() => onOpenTerminal(node.id)}
    />
  );
}
