import { EllipsisVertical } from "lucide-react";
import { useState, type Ref } from "react";
import {
  mobileTerminalShortcutOption,
  type MobileTerminalShortcut,
} from "../../mobileTerminalShortcuts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { chatKeyName } from "./chatKeys";

export function ChatComposerTools({
  buttonRef,
  disabled,
  commandsAvailable,
  onCommands,
  shortcutRows = [],
  onRunShortcut,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  disabled: boolean;
  commandsAvailable: boolean;
  onCommands: () => void;
  /** The Terminal's key controls; each press goes to the agent's pane. */
  shortcutRows?: (MobileTerminalShortcut | null)[][];
  onRunShortcut?: (shortcut: MobileTerminalShortcut) => void;
}) {
  const [open, setOpen] = useState(false);
  const keys = onRunShortcut
    ? shortcutRows.filter((row) => row.some(Boolean))
    : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          className="terminal-composer-more"
          aria-label="More composer controls"
          title="More composer controls"
          disabled={disabled}
        >
          <EllipsisVertical size={18} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="chat-composer-tools-popover"
        aria-label="Composer controls"
        side="top"
        align="end"
        sideOffset={6}
      >
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onCommands();
          }}
          disabled={!commandsAvailable}
        >
          Browse commands <kbd>/</kbd>
        </button>
        {keys.length ? (
          // The popover stays open so a menu can be walked key by key.
          <div className="chat-composer-keys" role="group" aria-label="Keys">
            {keys.map((row, rowIndex) => (
              <div className="chat-composer-key-row" key={rowIndex}>
                {row.map((shortcut, slot) => {
                  if (!shortcut) return <span key={slot} aria-hidden="true" />;
                  const label =
                    mobileTerminalShortcutOption(shortcut.action)?.label ??
                    shortcut.label;
                  const pressable = chatKeyName(shortcut.action) !== null;
                  return (
                    <button
                      key={shortcut.id}
                      type="button"
                      aria-label={`Press ${label}`}
                      title={
                        pressable
                          ? `Press ${label} in the agent's terminal`
                          : `Chat cannot press ${label}; use the Terminal`
                      }
                      disabled={!pressable}
                      onClick={() => onRunShortcut!(shortcut)}
                    >
                      {shortcut.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
