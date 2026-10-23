import { elapsed } from "./now";
import { AskCard, UNCONFIRMED } from "./ask";
import type { AnswerResult, PendingPrompt } from "../types";

/** Only live step/prompt content trails the transcript. Sends stay at their time. */
export function ChatAfterBlocks({
  running,
  clock,
  answered,
  prompt,
  agent,
  answering,
  notice,
  onAnswer,
  onOpenTerminal,
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
        "number" | "label" | "acknowledged" | "unconfirmed_reason"
      > & { question: string[] })
    | null;
  prompt: PendingPrompt | null;
  agent: string;
  answering: boolean;
  notice: string;
  onAnswer: (key: string) => void;
  onOpenTerminal?: () => void;
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
          {answered.acknowledged
            ? null
            : ` · ${UNCONFIRMED[answered.unconfirmed_reason ?? "still_showing"]}`}
          <span className="agent-chat-answered-question">
            {answered.question.join(" ")}
          </span>
        </p>
      ) : null}
      {prompt ? (
        <AskCard
          agent={agent}
          prompt={prompt}
          answering={answering}
          notice={notice}
          onAnswer={onAnswer}
          onOpenTerminal={onOpenTerminal}
        />
      ) : null}
    </>
  );
}
