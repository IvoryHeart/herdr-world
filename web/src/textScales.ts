import { useEffect, useSyncExternalStore } from "react";
import { subscribeLocalStorage, worldLocalStorage } from "./browserStorage";
import { chatTextSize, normalizeChatTextScale } from "./appearance";

export const TERMINAL_FONT_SCALE_KEY = "terminalFontScale";
const CHAT_TEXT_SCALE_KEY = "chatTextScale";

// Chat's own text scale (null while it follows the terminal's), and the
// terminal font scale App last reported, so either change resizes Chat.
let chatScale = normalizeChatTextScale(
  worldLocalStorage.getItem(CHAT_TEXT_SCALE_KEY),
);
let terminalScale = 100;
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.style.setProperty(
    "--chat-font-size",
    chatTextSize(chatScale, terminalScale),
  );
  for (const listener of listeners) listener();
}

export function getChatTextScale() {
  return chatScale;
}

export function setChatTextScale(scale: number | null) {
  chatScale = scale;
  worldLocalStorage.setItem(
    CHAT_TEXT_SCALE_KEY,
    scale === null ? "linked" : String(scale),
  );
  apply();
}

export function useChatTextScale() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getChatTextScale);
}

/** App: save the terminal font scale and size Chat's text from both. */
export function useTextScales(terminalFontScale: number) {
  useEffect(() => {
    worldLocalStorage.setItem(
      TERMINAL_FONT_SCALE_KEY,
      String(terminalFontScale),
    );
    terminalScale = terminalFontScale;
    apply();
  }, [terminalFontScale]);
  useEffect(
    () =>
      subscribeLocalStorage((key) => {
        if (key !== null && key !== CHAT_TEXT_SCALE_KEY) return;
        chatScale = normalizeChatTextScale(
          worldLocalStorage.getItem(CHAT_TEXT_SCALE_KEY),
        );
        apply();
      }),
    [],
  );
}
