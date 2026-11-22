import { useLayoutEffect } from "react";

/**
 * A presence flag on <html>: set while any holder holds it. Shell styles read
 * these instead of `body:has(...)`; a `:has()` on a shell ancestor makes
 * Chrome restyle large parts of the page on DOM changes below it, such as
 * each typed key (#1231).
 */
const holders = new Map<string, number>();

export function holdRootFlag(attribute: string): () => void {
  const root = document.documentElement;
  holders.set(attribute, (holders.get(attribute) ?? 0) + 1);
  root.setAttribute(attribute, "");
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (holders.get(attribute) ?? 1) - 1;
    if (left > 0) {
      holders.set(attribute, left);
      return;
    }
    holders.delete(attribute);
    root.removeAttribute(attribute);
  };
}

/** Holds `attribute` on <html> while mounted and `active`; before paint. */
export function useRootFlag(attribute: string, active = true) {
  useLayoutEffect(
    () => (active ? holdRootFlag(attribute) : undefined),
    [attribute, active],
  );
}
