import { formatUiDateTime } from "../../../uiLocale";
import { HISTORY_PREVIEW_CHARS } from "../../AgentHistoryCard";
import "./command.css";

export function CommandReceipt({
  text,
  at,
  observed = false,
  detail,
  onDismiss,
}: {
  text: string;
  at: string;
  observed?: boolean;
  detail?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="agent-chat-command-receipt"
      data-delivery={observed ? "matched" : "unchecked"}
      title={detail}
    >
      <code>{text.slice(0, HISTORY_PREVIEW_CHARS)}</code>
      <span>{observed ? "seen in the transcript" : "sent, not checked"}</span>
      <time dateTime={at} title={at}>
        {formatUiDateTime(at)}
      </time>
      {onDismiss ? (
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
