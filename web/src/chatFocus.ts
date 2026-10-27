import { useLayoutEffect, useRef, useState } from "react";

/** A single explicit opening's permission to focus its eventual editor. */
export type ChatFocusIntent = {
  focus(input: HTMLTextAreaElement): boolean;
  cancel(): void;
};

let pending: ChatFocusIntent | null = null;

export function requestChatInputFocus(
  isCurrent: () => boolean = () => true,
): ChatFocusIntent {
  pending?.cancel();
  const owner = document;
  const origin = owner.activeElement;
  let cancelled = false;
  // Opening Chat may remove its own button (Town's peek). The resulting
  // body focus is teardown, not a later user focus/input choice.
  const atOrigin = (target: EventTarget | null) =>
    target === origin ||
    (origin !== null && !origin.isConnected && target === owner.body);
  const moved = (event: FocusEvent) => {
    if (!atOrigin(event.target)) intent.cancel();
  };
  const cancel = () => {
    cancelled = true;
    owner.removeEventListener("focusin", moved, true);
    owner.removeEventListener("pointerdown", cancel, true);
    owner.removeEventListener("keydown", cancel, true);
    owner.defaultView?.removeEventListener("blur", cancel);
    if (pending === intent) pending = null;
  };
  const intent: ChatFocusIntent = {
    cancel,
    focus(input) {
      if (
        cancelled ||
        pending !== intent ||
        !isCurrent() ||
        !atOrigin(owner.activeElement) ||
        input.ownerDocument !== owner ||
        !input.isConnected
      ) {
        cancel();
        return false;
      }
      cancel();
      input.focus({ preventScroll: true });
      return owner.activeElement === input;
    },
  };
  pending = intent;
  owner.addEventListener("focusin", moved, true);
  owner.addEventListener("pointerdown", cancel, true);
  owner.addEventListener("keydown", cancel, true);
  owner.defaultView?.addEventListener("blur", cancel);
  return intent;
}

/** The stable Inspector owns activation, even when its session child remounts. */
export function useChatFocusIntent(
  active: boolean,
  supplied?: ChatFocusIntent | null,
) {
  const [intent, setIntent] = useState<ChatFocusIntent | null>(null);
  const wasActive = useRef(false);
  useLayoutEffect(() => {
    const leaving = wasActive.current && !active;
    wasActive.current = active;
    if (!active) {
      if (leaving) supplied?.cancel();
      setIntent(null);
      return;
    }
    // null is a deliberate focus-neutral preview; undefined is a local open.
    if (supplied !== undefined) {
      setIntent(supplied);
      return;
    }
    const requested = requestChatInputFocus();
    setIntent(requested);
    return requested.cancel;
  }, [active, supplied]);
  return intent;
}
