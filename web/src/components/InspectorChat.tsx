import type { ComponentProps } from "react";
import { useChatFocusIntent } from "../chatFocus";
import { AgentChat } from "./AgentChat";
import {
  InspectorSourceFiles,
  type InspectorSourceFilesProps,
} from "./InspectorSourceFiles";

/** Keep opening intent outside the session-keyed conversation lifetime. */
export function InspectorChat({
  sourceFiles,
  ...props
}: ComponentProps<typeof AgentChat> & {
  sourceFiles?: InspectorSourceFilesProps;
}) {
  const focusIntent = useChatFocusIntent(props.active, props.focusIntent);
  const chat = (
    <AgentChat
      key={JSON.stringify([
        props.pane.pane_id,
        props.workSessionFingerprint ?? null,
      ])}
      {...props}
      focusIntent={focusIntent}
    />
  );
  return sourceFiles?.worktree ? (
    <InspectorSourceFiles source={sourceFiles}>{chat}</InspectorSourceFiles>
  ) : (
    chat
  );
}
