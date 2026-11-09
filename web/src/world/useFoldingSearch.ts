import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { formatShortcut } from "../shortcutBindings";
import { useShortcutPreferences } from "../shortcutPreferences";

const PHONE_QUERY = "(max-width: 720px)";

/** Whether the viewport is a phone's, where views search from an icon. */
export function usePhoneViewport(): boolean {
  const [phone, setPhone] = useState(
    () => window.matchMedia(PHONE_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return phone;
}

/** "Search Town (/ or Ctrl+F)", naming the user's own `view.search` keys. */
export function useViewSearchTitle(label: string): string {
  const { preset, platform } = useShortcutPreferences();
  const keys = preset.bindings["view.search"].map((key) =>
    formatShortcut(key, platform),
  );
  return keys.length ? `${label} (${keys.join(" or ")})` : label;
}

/**
 * A desktop view search that rests as an icon. Clicking the icon or pressing
 * the search keys expands it into the text box with the cursor in it; it folds
 * back on Escape, or when it loses focus while empty. A query keeps it open.
 * With `enabled` false (a phone) it never folds here.
 */
export function useFoldingSearch(query: string, enabled = true) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const focusNext = useRef<"input" | "toggle" | null>(null);
  const folded = enabled && !open && !query;

  // Expanding mounts the box, and folding mounts the icon: focus follows.
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "input") inputRef.current?.focus();
    else if (
      !document.activeElement ||
      document.activeElement === document.body
    )
      toggleRef.current?.focus();
  });

  return {
    folded,
    inputRef,
    toggleRef,
    /** The icon, `/` or Ctrl+F: show the box and put the cursor in it. */
    expand() {
      if (folded) {
        focusNext.current = "input";
        setOpen(true);
      } else inputRef.current?.focus();
    },
    /** Escape: fold to the icon, which keeps the keyboard's place. */
    fold() {
      focusNext.current = "toggle";
      setOpen(false);
    },
    /** Spread on the search box: focus opens it, leaving it lets it fold. */
    boxProps: {
      onFocus: () => setOpen(true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setOpen(false);
      },
    },
  };
}
