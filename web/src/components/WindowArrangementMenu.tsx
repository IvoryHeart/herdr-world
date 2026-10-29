import { useLayer } from "../layerStack";
import { useLayoutPreferences } from "../layoutPreferences";
import {
  WindowSwitcher,
  type WindowSwitcherEntry,
} from "../world/windows/WindowSwitcher";
import { LayoutGrid, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { measuredFixedPositionScale } from "../fixedPositionScale";
import { shortcutLabel, useShortcutPreferences } from "../shortcutPreferences";
import type { ShortcutId } from "../shortcutBindings";
import type { TerminalWindowArrangementPreset } from "../world/terminalWindowArrangement";
import "./WindowArrangementMenu.css";

export type WindowArrangementCommand =
  | TerminalWindowArrangementPreset
  | "restore"
  | "close-all"
  | "open-all";

export type WindowArrangementControl = {
  windows?: readonly WindowSwitcherEntry[];
  activePreset: TerminalWindowArrangementPreset | null;
  disabledReasons: Partial<Record<WindowArrangementCommand, string>>;
  onSelect: (command: WindowArrangementCommand) => void;
};

export const WINDOW_ARRANGEMENT_CHOICES: readonly {
  command: WindowArrangementCommand;
  label: string;
  description: string;
  shortcutId?: ShortcutId;
}[] = [
  {
    command: "single",
    label: "Single",
    description: "Show the active window",
    shortcutId: "arrangement.single",
  },
  {
    command: "cascade",
    label: "Cascade",
    description: "Overlap windows diagonally",
    shortcutId: "arrangement.cascade",
  },
  {
    command: "columns",
    label: "Columns",
    description: "Fit windows side by side",
    shortcutId: "arrangement.columns",
  },
  {
    command: "rows",
    label: "Rows",
    description: "Fit windows top to bottom",
    shortcutId: "arrangement.rows",
  },
  {
    command: "grid",
    label: "Grid",
    description: "Tile four corners",
    shortcutId: "arrangement.grid",
  },
  {
    command: "restore",
    label: "Restore positions",
    description: "Return still-open windows to their previous positions",
    shortcutId: "arrangement.restore",
  },
  {
    command: "close-all",
    label: "Close all terminal windows",
    description: "Dismiss windows without closing tabs or sessions",
  },
  {
    command: "open-all",
    label: "Open all terminal windows",
    description: "Present every terminal on the selected host",
  },
];

export function WindowArrangementMenu({
  control,
  showWindowSwitcher = true,
}: {
  control: WindowArrangementControl;
  showWindowSwitcher?: boolean;
}) {
  const { mobile } = useLayoutPreferences();
  useShortcutPreferences();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Escape, a press outside and Back close it through the shared stack.
  useLayer(open, () => setOpen(false), {
    element: () => menuRef.current,
    anchors: () => [triggerRef.current],
  });

  useEffect(() => {
    if (!open) return;
    const closeMenu = () => setOpen(false);
    const items =
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    const firstEnabled = [...(items ?? [])].find(
      (item) => item.getAttribute("aria-disabled") !== "true",
    );
    (firstEnabled ?? items?.[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const triggerRect = open ? triggerRef.current?.getBoundingClientRect() : null;
  const scale = open ? measuredFixedPositionScale() : 1;
  const menuWidth = Math.min(246, (window.innerWidth - 16) / scale);
  const menuHeight = Math.min(420, (window.innerHeight * 0.8) / scale);
  const menuWidthOnScreen = menuWidth * scale;
  const menuHeightOnScreen = menuHeight * scale;
  const position: React.CSSProperties | undefined = triggerRect
    ? {
        width: menuWidth,
        maxHeight: menuHeight,
        left:
          Math.max(
            8,
            Math.min(
              triggerRect.right - menuWidthOnScreen,
              window.innerWidth - menuWidthOnScreen - 8,
            ),
          ) / scale,
        top:
          (triggerRect.bottom + menuHeightOnScreen + 8 <= window.innerHeight
            ? triggerRect.bottom + 4
            : Math.max(8, triggerRect.top - menuHeightOnScreen - 4)) / scale,
      }
    : undefined;

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    ];
    const current = items.findIndex((item) => item === document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };

  if (mobile && showWindowSwitcher)
    return control.windows?.some((entry) => entry.minimized) ? (
      <WindowSwitcher entries={control.windows} />
    ) : null;

  return (
    <>
      {showWindowSwitcher && control.windows ? (
        <WindowSwitcher entries={control.windows} />
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={`tabbar-arrangement-trigger ${open ? "is-active" : ""}`}
        aria-label="Arrange windows"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Arrange windows"
        onClick={() => setOpen((current) => !current)}
      >
        <LayoutGrid size={16} aria-hidden="true" />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Arrange windows"
              className="window-arrangement-menu"
              style={position}
              onKeyDown={onMenuKeyDown}
            >
              {WINDOW_ARRANGEMENT_CHOICES.map(
                ({ command, label, description, shortcutId }) => {
                  const reason = control.disabledReasons[command];
                  const shortcut = shortcutId
                    ? shortcutLabel(shortcutId)
                    : "Unassigned";
                  return (
                    <button
                      key={command}
                      type="button"
                      role="menuitem"
                      aria-disabled={!!reason}
                      className={`window-arrangement-option ${control.activePreset === command ? "is-active" : ""}`}
                      title={reason ?? description}
                      onClick={() => {
                        if (reason) return;
                        setOpen(false);
                        control.onSelect(command);
                        queueMicrotask(() => triggerRef.current?.focus());
                      }}
                    >
                      {command === "restore" || command === "close-all" ? (
                        <RotateCcw size={19} aria-hidden="true" />
                      ) : (
                        <span
                          className={`window-arrangement-preview is-${command}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      <span className="window-arrangement-copy">
                        <strong>{label}</strong>
                        <small>{reason ?? description}</small>
                      </span>
                      {shortcut !== "Unassigned" ? (
                        <kbd className="window-arrangement-shortcut">
                          {shortcut}
                        </kbd>
                      ) : null}
                    </button>
                  );
                },
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
