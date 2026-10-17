import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import type { TownChoice } from "./townChat";
import { townStatusText } from "./TownPeek";

export type TownDockPane = {
  key: string;
  label: string;
  status: OfficeAgent["semanticStatus"] | "shell";
};

/**
 * The chat dock: one desk's panes as tabs, the selected pane's live screen,
 * one-key answers and a composer. The real terminal stays one tap away.
 */
export function TownDock({
  title,
  where,
  agent,
  panes,
  activePane,
  screen,
  choices,
  canReply,
  onPane,
  onReply,
  onBack,
  onNext,
  onTerminal,
}: {
  title: string;
  where: string;
  agent: OfficeAgent | null;
  panes: readonly TownDockPane[];
  activePane: string;
  screen: string | null;
  choices: readonly TownChoice[];
  canReply: boolean;
  onPane(key: string): void;
  onReply(text: string, submit: boolean): Promise<boolean>;
  onBack(): void;
  onNext: (() => void) | null;
  onTerminal(): void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const screenRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft("");
    follow.current = true;
    composer.current?.focus({ preventScroll: true });
  }, [activePane]);

  useLayoutEffect(() => {
    const element = screenRef.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [screen]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const sent = await onReply(text, true);
    setSending(false);
    if (sent) setDraft("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  };
  const lines = (screen ?? "").replace(/\s+$/, "");

  return (
    <aside className="town-dock" aria-label={`Chat with ${title}`}>
      <header>
        <button
          type="button"
          className="town-dock-back"
          aria-label="Back to the town"
          onClick={onBack}
        >
          ‹
        </button>
        <div className="town-dock-title">
          <b>{title}</b>
          <small>
            {agent ? (
              <span className={`town-pill town-pill-${agent.semanticStatus}`}>
                {townStatusText(agent)}
              </span>
            ) : null}{" "}
            {where}
          </small>
        </div>
        {onNext ? (
          <button
            type="button"
            className={`town-dock-next${agent?.semanticStatus === "blocked" ? "" : " town-hot"}`}
            onClick={onNext}
          >
            Next ›
          </button>
        ) : null}
      </header>
      {panes.length > 1 ? (
        <nav className="town-dock-panes" aria-label="Panes on this desk">
          {panes.map((pane) => (
            <button
              key={pane.key}
              type="button"
              aria-pressed={pane.key === activePane}
              onClick={() => onPane(pane.key)}
            >
              <i
                className={`town-dot town-dot-${pane.status}`}
                aria-hidden="true"
              />
              {pane.label}
            </button>
          ))}
        </nav>
      ) : null}
      <pre
        ref={screenRef}
        className="town-dock-screen"
        aria-label="Live screen"
        aria-live="off"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
      >
        {screen === null
          ? "Reading the screen…"
          : lines || "Nothing on screen yet."}
      </pre>
      {choices.length && canReply ? (
        <div
          className="town-answers town-dock-answers"
          role="group"
          aria-label="Answers"
        >
          {choices.map((choice, index) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => void onReply(choice.key, false)}
            >
              {choice.label}
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </div>
      ) : null}
      <form className="town-dock-composer" onSubmit={submit}>
        <textarea
          ref={composer}
          rows={1}
          value={draft}
          disabled={!canReply}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keydown}
          placeholder={
            canReply
              ? "Message the agent…"
              : "This pane cannot take input right now"
          }
          aria-label={`Message ${title}`}
          enterKeyHint="send"
        />
        <button type="submit" disabled={!canReply || !draft.trim() || sending}>
          Send
        </button>
      </form>
      <div className="town-dock-foot">
        <button
          type="button"
          disabled={!canReply}
          title="Press Enter in this pane"
          onClick={() => void onReply("", true)}
        >
          ⏎ Enter
        </button>
        <button
          type="button"
          title="Terminal, files, changes and history"
          onClick={onTerminal}
        >
          Open Inspector
        </button>
      </div>
    </aside>
  );
}
