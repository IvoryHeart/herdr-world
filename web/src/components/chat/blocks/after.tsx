import type { ReactNode } from "react";
import { elapsed } from "./now";
import { AskCard, UNCONFIRMED } from "./ask";
import { MenuCard } from "./menu";
import { TrustCard } from "./trust";
import type { AnswerResult, PendingPrompt, TrustChoice } from "../types";

/** Only live step/prompt content trails the transcript. Sends stay at their time. */
export function ChatAfterBlocks({
  running,
  clock,
  answered,
  prompt,
  tooSmall,
  agent,
  answering,
  notice,
  onAnswer,
  pressing = false,
  onPress,
  onType,
  onOpenTerminal,
  onTrust,
  renderPromptMessage,
}: {
  running: {
    id: string;
    name: string;
    summary: string | null;
    started_at: string;
  } | null;
  clock: number;
  answered:
    | (Pick<
        Extract<AnswerResult, { status: "sent" }>,
        "number" | "label" | "text" | "acknowledged" | "unconfirmed_reason"
      > & { question: string[] })
    | null;
  prompt: PendingPrompt | null;
  tooSmall?: { rows: number };
  agent: string;
  answering: boolean;
  notice: string;
  onAnswer: (key: string, text?: string) => void;
  /** A command menu's keys, checked against that menu before each one. */
  pressing?: boolean;
  onPress?: (key: string) => void;
  onType?: (text: string) => void;
  onOpenTerminal?: () => void;
  /** Claude's folder-trust choice, before it has a session. */
  onTrust?: (choice: TrustChoice) => void;
  renderPromptMessage?: (message: ReactNode) => ReactNode;
}) {
  return (
    <>
      {running ? (
        <div className="agent-chat-running" data-call-id={running.id}>
          <span className="agent-chat-spinner" aria-hidden="true" />
          <span className="agent-chat-running-label" role="status">
            <b>{running.name}</b>
            {running.summary ? <code>{running.summary}</code> : null}
          </span>
          {Number.isFinite(Date.parse(running.started_at)) &&
          clock >= Date.parse(running.started_at) ? (
            <span className="agent-chat-now-time" aria-hidden="true">
              {elapsed(clock - Date.parse(running.started_at))}
            </span>
          ) : null}
        </div>
      ) : null}
      {answered ? (
        <p className="agent-chat-answered" role="status">
          {answered.acknowledged ? "You answered" : "Sent"}{" "}
          <b>
            {answered.number} · {answered.label}
          </b>
          {answered.text !== undefined ? (
            <>
              {" "}
              · <q>{answered.text}</q>
            </>
          ) : null}
          {answered.acknowledged
            ? null
            : ` · ${UNCONFIRMED[answered.unconfirmed_reason ?? "still_showing"]}`}
          <span className="agent-chat-answered-question">
            {answered.question.join(" ")}
          </span>
        </p>
      ) : null}
      {!prompt && tooSmall ? (
        <div
          className="agent-chat-ask agent-chat-menu"
          role="status"
          aria-label="Terminal too small"
        >
          <p>
            The terminal is too small to show this menu — open or click Terminal
            to fix.
          </p>
          {onOpenTerminal ? (
            <button type="button" onClick={onOpenTerminal}>
              Open Terminal
            </button>
          ) : null}
        </div>
      ) : null}
      {prompt?.trust ? (
        onTrust ? (
          <TrustCard
            key={prompt.fingerprint}
            prompt={prompt}
            choosing={answering}
            notice={notice}
            onChoose={onTrust}
            onOpenTerminal={onOpenTerminal}
            renderMessage={renderPromptMessage}
          />
        ) : null
      ) : prompt?.menu && onPress && onType ? (
        <MenuCard
          // One card for the menu's steps, so keyboard focus survives each
          // redraw; the scope above remounts it for another session.
          key="menu"
          agent={agent}
          prompt={{ ...prompt, menu: prompt.menu }}
          pressing={pressing}
          notice={notice}
          onPress={onPress}
          onType={onType}
          onOpenTerminal={onOpenTerminal}
        />
      ) : prompt && !prompt.menu ? (
        <AskCard
          key={prompt.fingerprint}
          agent={agent}
          prompt={prompt}
          answering={answering}
          notice={notice}
          onAnswer={onAnswer}
          onOpenTerminal={onOpenTerminal}
          renderMessage={renderPromptMessage}
        />
      ) : notice ? (
        <p className="agent-chat-ask-notice" role="alert">
          {notice}{" "}
          {onOpenTerminal ? (
            <button type="button" onClick={onOpenTerminal}>
              Open Terminal
            </button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
