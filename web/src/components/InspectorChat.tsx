import type { ComponentProps } from "react";
import { useChatFocusIntent } from "../chatFocus";
import { AgentChat } from "./AgentChat";

/** Keep opening intent outside the session-keyed conversation lifetime. */
export function InspectorChat(props: ComponentProps<typeof AgentChat>) {
  const focusIntent = useChatFocusIntent(props.active, props.focusIntent);
  return (
    <AgentChat
      key={JSON.stringify([
        props.pane.pane_id,
        props.workSessionFingerprint ?? null,
      ])}
      {...props}
      focusIntent={focusIntent}
    />
  );
}
