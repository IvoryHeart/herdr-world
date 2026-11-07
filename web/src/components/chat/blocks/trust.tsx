import { SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import type { PendingPrompt, TrustChoice, TrustResult } from "../types";
import "./ask.css";

/**
 * Pick one of Claude's folder-trust choices for this pane. Returns why
 * nothing was confirmed, or "" once Enter was sent. The service checks the
 * question and that Claude still has no session before every key.
 */
export async function chooseTrust(
  client: {
    call(method: string, params: Record<string, unknown>): Promise<unknown>;
    isCurrent?(): boolean;
  },
  paneId: string,
  prompt: PendingPrompt,
  choice: TrustChoice,
): Promise<string> {
  if (client.isCurrent && !client.isCurrent())
    return "The connection changed. Nothing was sent.";
  try {
    const result = (await client.call("agent_conversation.trust", {
      pane_id: paneId,
      prompt_fingerprint: prompt.fingerprint,
      choice,
    })) as TrustResult;
    if (result.status === "refused") return result.message;
    return result.acknowledged
      ? ""
      : `Sent "${result.label}", but the question still shows. Check the Terminal.`;
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason);
  }
}

/**
 * Claude's folder-trust question, asked before it starts a session: its
 * text, the folder, and its two choices in Claude's order, with the one its
 * cursor is on marked. A click is the choice; nothing is preselected here.
 */
export function TrustCard({
  prompt,
  choosing,
  notice,
  onChoose,
  onOpenTerminal,
  renderMessage,
}: {
  prompt: PendingPrompt;
  choosing: boolean;
  notice: string;
  onChoose(choice: TrustChoice): void;
  onOpenTerminal?: () => void;
  renderMessage?: (message: ReactNode) => ReactNode;
}) {
  const message = (
    <>
      {prompt.request.length ? <pre>{prompt.request.join("\n")}</pre> : null}
      {prompt.question.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </>
  );
  const terminal = onOpenTerminal ? (
    <button type="button" onClick={onOpenTerminal}>
      <SquareTerminal size={13} /> Open Terminal
    </button>
  ) : null;
  return (
    <section
      className="agent-chat-ask agent-chat-trust"
      aria-label="Claude asks whether to trust this folder"
    >
      <h3>Claude asks whether to trust this folder</h3>
      {renderMessage ? renderMessage(message) : message}
      <div className="agent-chat-ask-options" role="group" aria-label="Choices">
        {prompt.options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={option.cursor ? "is-cursor" : undefined}
            disabled={choosing}
            onClick={() => onChoose(option.key as TrustChoice)}
          >
            <span className="agent-chat-ask-label">
              {option.label}
              {option.cursor ? <small>Selected in the Terminal</small> : null}
            </span>
          </button>
        ))}
      </div>
      <p className="agent-chat-ask-fine">
        Claude has not started its session yet. Chat checks that this is still
        the same question in the same Claude process, moves Claude's selection
        to your choice and presses Enter, checking again before each key. Chat
        opens once the session starts. {terminal}
      </p>
      {notice ? (
        <p className="agent-chat-ask-notice" role="alert">
          {notice} {terminal}
        </p>
      ) : null}
    </section>
  );
}
