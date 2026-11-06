import { useEffect, useRef } from "react";
import { store } from "../store";
import {
  worldInspectorWindowId,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

/** Window identity, rather than host filters or focus, owns each Inspector hold. */
export function useFocusedInspectorInterest(
  conversations: readonly WorldInspectorConversation[],
): void {
  const held = useRef(new Map<string, () => void>());
  useEffect(() => {
    const next = new Map(
      conversations.map((conversation) => [
        JSON.stringify([
          worldInspectorWindowId(conversation),
          conversation.connectionId,
          conversation.runtimeGeneration,
          conversation.focusedListAdmissionAt ?? null,
        ]),
        conversation,
      ]),
    );
    for (const [key, release] of held.current)
      if (!next.has(key)) {
        held.current.delete(key);
        release();
      }
    for (const [key, conversation] of next)
      if (!held.current.has(key))
        held.current.set(
          key,
          store.holdFocusedOwner({
            connection_id: conversation.connectionId,
            connection_generation: conversation.runtimeGeneration,
          }),
        );
  }, [conversations]);
  useEffect(() => {
    const holds = held.current;
    return () => {
      for (const release of holds.values()) release();
      holds.clear();
    };
  }, []);
}
