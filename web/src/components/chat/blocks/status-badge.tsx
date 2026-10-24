import { STATUS_WORDS } from "./now";
import { Check } from "lucide-react";
import "./status-badge.css";
export function ChatStatusBadge({ status }: { status: string }) {
  const label = STATUS_WORDS[status] ?? status;
  return (
    <span
      className={`agent-chat-state-circle is-${status.toLowerCase()}`}
      title={label}
    >
      <span className="agent-chat-state-glyph" aria-hidden="true">
        {status === "done" ? (
          <Check size={12} />
        ) : status === "blocked" ? (
          "!"
        ) : null}
      </span>
      <span className="agent-chat-state-word">{label}</span>
    </span>
  );
}
