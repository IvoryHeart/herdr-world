import type { KeyboardEvent, ReactNode } from "react";
import type { ShortcutNumber } from "../shortcutBindings";
import {
  getShortcutSnapshot,
  shortcutLabel,
  useShortcutPreferences,
} from "../shortcutPreferences";
import { CommandItem, CommandShortcut } from "./ui/command";

/**
 * One row of the command box (CommandCombobox.tsx): icon, title and detail,
 * then optional trailing marks (a found agent's runtime and status), a second
 * action's button (#1329: show it in the current view) and its shortcut.
 */
export function ActionItem({
  value,
  icon,
  title,
  detail,
  shortcut,
  numberShortcutIndex,
  keywords,
  danger,
  onSelect,
  disabledReason,
  trailing,
  secondary,
}: {
  value: string;
  icon: ReactNode;
  title: string;
  detail?: string;
  shortcut?: string;
  numberShortcutIndex?: number;
  keywords?: string[];
  danger?: boolean;
  onSelect: () => void;
  disabledReason?: string | null;
  trailing?: ReactNode;
  secondary?: { label: string; run: () => void };
}) {
  useShortcutPreferences();
  const id =
    numberShortcutIndex === undefined
      ? null
      : (`command.${numberShortcutIndex + 1}` as `command.${ShortcutNumber}`);
  const numberShortcut = id ? shortcutLabel(id) : null;
  return (
    <CommandItem
      value={value}
      disabled={!!disabledReason}
      title={disabledReason ?? undefined}
      keywords={keywords}
      onSelect={onSelect}
      className={danger ? "is-danger" : undefined}
      aria-keyshortcuts={
        id
          ? getShortcutSnapshot()
              .preset.bindings[id].map((key) => key.replace("Ctrl", "Control"))
              .join(" ") || undefined
          : undefined
      }
    >
      <span className="command-item-icon">{icon}</span>
      <span className="command-item-text">
        <span className="command-item-title">{title}</span>
        {disabledReason || detail ? (
          <span className="command-item-detail">
            {disabledReason ?? detail}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="command-item-trailing">{trailing}</span>
      ) : null}
      {secondary ? (
        <button
          type="button"
          className="command-item-secondary"
          title={`${secondary.label} (Shift+Enter)`}
          // The row's own click opens; this button only shows.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            secondary.run();
          }}
        >
          {secondary.label}
        </button>
      ) : null}
      {numberShortcut || shortcut ? (
        <CommandShortcut>{numberShortcut ?? shortcut}</CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

/**
 * Shift+Enter runs the selected row's second action (World's finds: open its
 * terminal); true when it did.
 */
export function runSecondaryKey(
  event: KeyboardEvent<HTMLElement>,
  row:
    | { secondary?: { run: () => void }; disabledReason?: string | null }
    | undefined,
  run: (fn: () => void) => void,
) {
  if (
    event.key !== "Enter" ||
    !event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.nativeEvent.isComposing ||
    !row?.secondary ||
    row.disabledReason
  )
    return false;
  event.preventDefault();
  event.stopPropagation();
  run(row.secondary.run);
  return true;
}
