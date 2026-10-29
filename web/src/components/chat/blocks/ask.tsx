import { SquareTerminal } from "lucide-react";
import { useState } from "react";
import type { PendingPrompt, UnconfirmedReason } from "../types";
import "./ask.css";

export const UNCONFIRMED: Record<UnconfirmedReason, string> = {
  still_showing:
    "the question is still showing; check the Terminal if it does not move on.",
  session_changed:
    "the pane has another session now, so the key may have reached it. Check the Terminal.",
  unknown_status:
    "Herdr does not say what the agent is doing now, so Chat cannot confirm the answer. Check the Terminal.",
  agent_missing:
    "Herdr no longer reports the agent, so Chat cannot confirm the answer. Check the Terminal.",
  unreadable:
    "Chat could not read the screen to confirm the answer. Check the Terminal.",
};

/**
 * The agent's own question, with its options as buttons. The options are read
 * from the agent's prompt and each presses that option's key; when none can be
 * read, Chat shows the question and the way to the Terminal instead of
 * guessing.
 */
export function AskCard({
  agent,
  prompt,
  answering,
  notice,
  onAnswer,
  onOpenTerminal,
}: {
  agent: string;
  prompt: PendingPrompt;
  answering: boolean;
  notice: string;
  onAnswer(key: string, text?: string): void;
  onOpenTerminal?: () => void;
}) {
  const nativeEditor = prompt.options.some((option) => option.active);
  const options = nativeEditor ? [] : prompt.options;
  const [textKey, setTextKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const textOption = options.find((option) => option.key === textKey);
  const choose = (key: string) => {
    const option = options.find((item) => item.key === key);
    if (option?.input) setTextKey(key);
    else onAnswer(key);
  };
  const terminal = onOpenTerminal ? (
    <button type="button" onClick={onOpenTerminal}>
      <SquareTerminal size={13} /> Answer in the Terminal
    </button>
  ) : null;
  return (
    <section
      className="agent-chat-ask"
      aria-label={`${agent} is waiting`}
      // Keys answer only while this card has focus, and a held key repeats
      // nothing: another Chat's question is never answered from here.
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.repeat ||
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          answering ||
          (event.target instanceof HTMLElement &&
            event.target.closest(
              "input, textarea, button, [contenteditable=true]",
            ))
        )
          return;
        const option = options.find(
          (candidate) => candidate.number === event.key,
        );
        if (!option) return;
        event.preventDefault();
        choose(option.key);
      }}
    >
      <h3>{agent} is waiting on you</h3>
      {prompt.steps?.length ? (
        // A form asks its questions one at a time, then submits them all.
        <ol
          className="agent-chat-ask-steps"
          aria-label="Questions in this form"
        >
          {prompt.steps.map((step, index) => (
            <li
              key={index}
              className={step.answered ? "is-answered" : undefined}
              aria-label={`${step.label}, ${step.answered ? "answered" : "not answered yet"}`}
            >
              <span aria-hidden="true">{step.answered ? "☒" : "☐"}</span>{" "}
              {step.label}
            </li>
          ))}
        </ol>
      ) : null}
      {prompt.request.length ? <pre>{prompt.request.join("\n")}</pre> : null}
      {prompt.question.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
      {options.length ? (
        <>
          <div
            className="agent-chat-ask-options"
            role="group"
            aria-label="Answers"
          >
            {options.map((option, index) => (
              <button
                key={option.number}
                type="button"
                className={index === 0 ? "is-primary" : undefined}
                disabled={answering}
                aria-expanded={
                  option.input ? textKey === option.key : undefined
                }
                onClick={() => choose(option.key)}
              >
                <kbd>{option.number}</kbd>
                <span className="agent-chat-ask-label">
                  {option.label}
                  {option.description ? (
                    <small>{option.description}</small>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
          {textOption?.input ? (
            <form
              className="agent-chat-ask-text"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim() && !answering) onAnswer(textOption.key, text);
              }}
            >
              <label>
                {textOption.label}
                <input
                  type="text"
                  value={text}
                  maxLength={4000}
                  required
                  autoFocus
                  disabled={answering}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <button type="submit" disabled={answering || !text.trim()}>
                Send text answer
              </button>
            </form>
          ) : null}
          <p className="agent-chat-ask-fine">
            Options read from {agent}'s own prompt. Chat checks the question
            again just before it presses the one you pick, but Herdr cannot hold
            it still: if it changes in that instant, the key reaches the new
            one. Text options open a reply field; Chat checks the editor before
            sending your text. With this card focused, its number picks it too.
          </p>
        </>
      ) : (
        <p className="agent-chat-ask-fine">
          {nativeEditor
            ? "This text editor is already open in the Terminal. Continue there."
            : "Chat cannot read the choices in this prompt safely, so it does not answer it."}{" "}
          {terminal}
        </p>
      )}
      {notice ? (
        <p className="agent-chat-ask-notice" role="alert">
          {notice} {terminal}
        </p>
      ) : null}
    </section>
  );
}
