import { useEffect, useState } from "react";
import { worldLocalStorage } from "../../browserStorage";
import {
  BOARD_APPEARANCE_KEY,
  boardAppearance,
  type BoardAppearance,
} from "./boardAppearance";

function read() {
  try {
    return boardAppearance(
      JSON.parse(worldLocalStorage.getItem(BOARD_APPEARANCE_KEY) ?? "null"),
    );
  } catch {
    return boardAppearance(null);
  }
}

export function useBoardAppearance() {
  const [appearance, setAppearance] = useState(read);
  useEffect(() => {
    const changed = () =>
      setAppearance((current) => {
        const next = read();
        return JSON.stringify(current) === JSON.stringify(next)
          ? current
          : next;
      });
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const change = (next: BoardAppearance) => {
    const validated = boardAppearance(next);
    setAppearance(validated);
    try {
      worldLocalStorage.setItem(
        BOARD_APPEARANCE_KEY,
        JSON.stringify(validated),
      );
    } catch {
      /* Browser storage can be unavailable; keep this page's choice. */
    }
  };
  return { appearance, change };
}
