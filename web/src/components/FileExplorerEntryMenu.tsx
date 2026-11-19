import { useEffect, useRef } from "react";
import { useLayer } from "../layerStack";
import { revealMenuLabel } from "../fileManager";
import type { FileExplorerEntry } from "../types";

export type FileExplorerEntryMenuState = {
  x: number;
  y: number;
  entry: FileExplorerEntry | null;
};

// Maximum number of directory actions, used to position the actions popup.
const ENTRY_MENU_ITEM_COUNT = 6;
export const ENTRY_MENU_WIDTH = 220;
export const ENTRY_MENU_HEIGHT = ENTRY_MENU_ITEM_COUNT * 34 + 8;

export function FileExplorerEntryMenu({
  state,
  onClose,
  onDownload,
  onCopy,
  onReveal,
  onOpenIde,
  onDelete,
  onCreateDirectory,
  onRefresh,
}: {
  state: FileExplorerEntryMenuState | null;
  onClose: () => void;
  onDownload: (entry: FileExplorerEntry) => void;
  onCopy: (entry: FileExplorerEntry) => void;
  onReveal?: (entry: FileExplorerEntry) => void;
  onOpenIde: (entry: FileExplorerEntry) => void;
  onDelete?: (entry: FileExplorerEntry) => void;
  onCreateDirectory?: (directory: string) => void;
  onRefresh: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Escape, a press outside and Back close it through the shared stack, which
  // returns focus to what had it.
  useLayer(state !== null, () => onCloseRef.current(), {
    element: () => ref.current,
  });

  useEffect(() => {
    if (!state) return;
    const close = () => onCloseRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        close();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const buttons = Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ??
          [],
      );
      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (!buttons.length || currentIndex < 0) return;
      e.preventDefault();
      const nextIndex =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : e.key === "ArrowDown"
              ? (currentIndex + 1) % buttons.length
              : (currentIndex - 1 + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    };
    const t = setTimeout(() => {
      window.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, true);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [state]);

  if (!state) return null;

  const { entry } = state;
  const isDirectory = entry?.type === "directory";
  const items: { label: string; action: () => void; danger?: boolean }[] = entry
    ? [
        ...(isDirectory && onCreateDirectory
          ? [
              {
                label: "New folder",
                action: () => onCreateDirectory(entry.path),
              },
            ]
          : []),
        {
          label: isDirectory ? "Download directory" : "Download file",
          action: () => onDownload(entry),
        },
        {
          label: "Open in…",
          action: () => onOpenIde(entry),
        },
        {
          label: "Copy absolute path",
          action: () => onCopy(entry),
        },
        ...(onReveal
          ? [
              {
                label: revealMenuLabel(isDirectory),
                action: () => onReveal(entry),
              },
            ]
          : []),
        ...(onDelete
          ? [
              {
                label: isDirectory ? "Delete directory" : "Delete file",
                danger: true,
                action: () => onDelete(entry),
              },
            ]
          : []),
      ]
    : [
        ...(onCreateDirectory
          ? [{ label: "New folder", action: () => onCreateDirectory("") }]
          : []),
        { label: "Refresh files", action: onRefresh },
      ];
  const menuMargin = 8;
  const menuWidth = ENTRY_MENU_WIDTH;
  const style: React.CSSProperties = {
    position: "fixed",
    width: `min(${ENTRY_MENU_WIDTH}px, calc(100vw - 2 * ${menuMargin}px))`,
    left: Math.max(
      menuMargin,
      Math.min(state.x, window.innerWidth - menuWidth - menuMargin),
    ),
    top: Math.max(
      menuMargin,
      Math.min(
        state.y,
        window.innerHeight - (items.length * 34 + 8) - menuMargin,
      ),
    ),
    zIndex: 1000,
  };

  return (
    <div ref={ref} className="context-menu" style={style} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu-item ${item.danger ? "is-danger" : ""}`}
          role="menuitem"
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
