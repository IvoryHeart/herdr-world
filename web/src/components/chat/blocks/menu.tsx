import { SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PendingPrompt } from "../types";
import "./ask.css";

// What a key on the focused card presses, when the menu names that key.
const CARD_KEYS: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "enter",
  Escape: "esc",
  Tab: "tab",
};

/**
 * A harness's own command menu, such as `/model` or `/permissions`, read from
 * its screen while the agent is idle. It shows the menu as the harness draws
 * it, with a button for each option a digit picks and each key its footer
 * names; every press is checked against this same menu first. Chat never
 * guesses a choice the menu does not number.
 */
export function MenuCard({
  agent,
  prompt,
  pressing,
  notice,
  onPress,
  onType,
  onOpenTerminal,
}: {
  agent: string;
  prompt: PendingPrompt & { menu: NonNullable<PendingPrompt["menu"]> };
  pressing: boolean;
  notice: string;
  onPress(key: string): void;
  onType(text: string): void;
  onOpenTerminal?: () => void;
}) {
  const { menu } = prompt;
  const [text, setText] = useState("");
  // A draft belongs to the field it was typed for.
  useEffect(() => setText(""), [prompt.fingerprint]);
  // After a key sent from inside the card, focus returns to the card itself,
  // whose keys work: the control that sent it was disabled meanwhile, and a
  // focused button would take the next arrow.
  const cardRef = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const own =
    <T extends unknown[]>(send: (...args: T) => void) =>
    (...args: T) => {
      refocus.current = Boolean(
        cardRef.current?.contains(document.activeElement),
      );
      send(...args);
    };
  const press = own(onPress);
  const type = own(onType);
  useEffect(() => {
    if (pressing || !refocus.current) return;
    refocus.current = false;
    cardRef.current?.focus({ preventScroll: true });
  }, [pressing, prompt.fingerprint]);
  const keys = new Set([
    ...prompt.options.map((option) => option.key).filter(Boolean),
    ...menu.controls.map((control) => control.key),
  ]);
  return (
    <section
      ref={cardRef}
      className="agent-chat-ask agent-chat-menu"
      aria-label={`${agent} menu`}
      // Keys reach the menu only while this card has focus, and a held key
      // repeats nothing.
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.repeat ||
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          pressing ||
          (event.target instanceof HTMLElement &&
            event.target.closest(
              "input, textarea, button, [contenteditable=true]",
            ))
        )
          return;
        const key =
          CARD_KEYS[event.key] ??
          (event.key.length === 1 ? event.key.toLowerCase() : "");
        if (!key || !keys.has(key)) return;
        event.preventDefault();
        event.stopPropagation();
        press(key);
      }}
    >
      <h3>{prompt.question.join(" ")}</h3>
      {prompt.request.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
      {menu.field !== undefined ? (
        <form
          className="agent-chat-ask-text"
          onSubmit={(event) => {
            event.preventDefault();
            if (text && !pressing) {
              type(text);
              setText("");
            }
          }}
        >
          <label>
            Field shows <q>{menu.field}</q>
            <input
              type="text"
              value={text}
              maxLength={500}
              disabled={pressing}
              placeholder="Text to type into it"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pressing || !text}>
            Type
          </button>
        </form>
      ) : null}
      {prompt.options.length ? (
        <div
          className="agent-chat-ask-options"
          role="group"
          aria-label="Options"
        >
          {prompt.options.map((option) => (
            <button
              key={option.number}
              type="button"
              aria-current={option.cursor || undefined}
              className={option.cursor ? "is-cursor" : undefined}
              disabled={pressing || !option.key}
              title={
                option.key
                  ? `Press ${option.key}`
                  : "Move the cursor here with ↑ and ↓"
              }
              onClick={() => press(option.key)}
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
      ) : null}
      {menu.after.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
      <div className="agent-chat-menu-keys" role="group" aria-label="Menu keys">
        {menu.controls.map((control) => (
          <button
            key={control.key}
            type="button"
            disabled={pressing}
            aria-label={`${control.label}: ${control.action}`}
            onClick={() => press(control.key)}
          >
            <kbd>{control.label}</kbd> {control.action}
          </button>
        ))}
      </div>
      <p className="agent-chat-ask-fine">
        Read from {agent}'s screen: <q>{menu.footer}</q>. Chat checks this menu
        again before each key, but Herdr cannot hold it still: if it changes in
        that instant, the key reaches what replaced it. With this card focused,
        its keys work too.{" "}
        {onOpenTerminal ? (
          <button type="button" onClick={onOpenTerminal}>
            <SquareTerminal size={13} /> Terminal
          </button>
        ) : null}
      </p>
      {notice ? (
        <p className="agent-chat-ask-notice" role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
