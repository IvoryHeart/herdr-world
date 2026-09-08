import { useCallback } from "react";

import { encodeMobileTerminalChord } from "./mobileTerminalControls";
import type { MobileTerminalChordKey } from "./mobileTerminalControls";

interface MobileTerminalKeyButtonProps {
  terminalKey: MobileTerminalChordKey;
  disabled: boolean;
  repeat: boolean;
  onInput: (data: string) => void;
}

const KEY_REPEAT_DELAY_MS = 400;
const KEY_REPEAT_INTERVAL_MS = 60;

/** Sends direct terminal keys; held repeats end when the button or input destination changes. */
export function MobileTerminalKeyButton({
  terminalKey,
  disabled,
  repeat,
  onInput,
}: MobileTerminalKeyButtonProps) {
  const data = encodeMobileTerminalChord(terminalKey, []);
  const attachButton = useCallback(
    (button: HTMLButtonElement | null) => {
      if (!button || disabled) {
        return;
      }
      let activePointerId: number | null = null;
      let repeatTimer: ReturnType<typeof setTimeout> | undefined;
      const stopRepeat = () => {
        clearTimeout(repeatTimer);
        activePointerId = null;
      };
      const sendRepeat = () => {
        if (activePointerId === null || document.hidden) {
          stopRepeat();
          return;
        }
        repeatTimer = setTimeout(sendRepeat, KEY_REPEAT_INTERVAL_MS);
        onInput(data);
      };
      const startPress = (event: PointerEvent) => {
        if (!event.isPrimary || event.button !== 0 || activePointerId !== null) {
          return;
        }
        // Keep the terminal keyboard focused and suppress native long-press gestures.
        event.preventDefault();
        activePointerId = event.pointerId;
        button.setPointerCapture(event.pointerId);
        if (repeat) {
          repeatTimer = setTimeout(sendRepeat, KEY_REPEAT_DELAY_MS);
        }
        onInput(data);
      };
      const endPress = (event: PointerEvent) => {
        if (event.pointerId === activePointerId) {
          stopRepeat();
        }
      };
      const movePress = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) {
          return;
        }
        const bounds = button.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          stopRepeat();
        }
      };
      const clickButton = (event: MouseEvent) => {
        // Pointer presses already sent their key. Keep keyboard and assistive clicks working.
        if (event.detail === 0) {
          onInput(data);
        }
      };
      const visibilityChanged = () => {
        if (document.hidden) {
          stopRepeat();
        }
      };
      const preventContextMenu = (event: Event) => event.preventDefault();
      button.addEventListener("pointerdown", startPress);
      button.addEventListener("pointermove", movePress);
      button.addEventListener("pointerleave", endPress);
      button.addEventListener("lostpointercapture", endPress);
      button.addEventListener("click", clickButton);
      button.addEventListener("contextmenu", preventContextMenu);
      window.addEventListener("pointerup", endPress);
      window.addEventListener("pointercancel", endPress);
      window.addEventListener("blur", stopRepeat);
      window.addEventListener("pagehide", stopRepeat);
      document.addEventListener("visibilitychange", visibilityChanged);
      return () => {
        stopRepeat();
        button.removeEventListener("pointerdown", startPress);
        button.removeEventListener("pointermove", movePress);
        button.removeEventListener("pointerleave", endPress);
        button.removeEventListener("lostpointercapture", endPress);
        button.removeEventListener("click", clickButton);
        button.removeEventListener("contextmenu", preventContextMenu);
        window.removeEventListener("pointerup", endPress);
        window.removeEventListener("pointercancel", endPress);
        window.removeEventListener("blur", stopRepeat);
        window.removeEventListener("pagehide", stopRepeat);
        document.removeEventListener("visibilitychange", visibilityChanged);
      };
    },
    [data, disabled, onInput, repeat],
  );

  return (
    <button
      ref={attachButton}
      className="term-key term-key-direct"
      type="button"
      aria-label={`Send ${terminalKey.name}`}
      title={repeat ? `${terminalKey.name}: tap or hold to repeat` : terminalKey.name}
      disabled={disabled}
    >
      {terminalKey.label}
    </button>
  );
}
