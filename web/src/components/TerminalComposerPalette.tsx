import { X } from "lucide-react";
import type { RefObject, KeyboardEvent, MouseEvent } from "react";
import type { ComposerCommand } from "../terminalComposerCommands";

/** The existing command palette, shared by the terminal and Chat composer. */
export function TerminalComposerPalette({
  commandPickerRef,
  selectedCommand,
  pickerId,
  activeCommand,
  commandKeyDown,
  keepTextareaFocus,
  closeCommandPicker,
  replacement,
  replacementCancelRef,
  setReplacement,
  focusPickerWithoutKeyboard,
  busy,
  composing,
  selectCommand,
  commandListRef,
  matches,
}: {
  commandPickerRef: RefObject<HTMLElement>;
  selectedCommand?: ComposerCommand;
  pickerId: string;
  activeCommand: number;
  commandKeyDown: (event: KeyboardEvent) => boolean;
  keepTextareaFocus: (event: MouseEvent<HTMLButtonElement>) => void;
  closeCommandPicker: () => void;
  replacement: { command: ComposerCommand; draft: string } | null;
  replacementCancelRef: RefObject<HTMLButtonElement>;
  setReplacement: (value: null) => void;
  focusPickerWithoutKeyboard: () => void;
  busy: boolean;
  composing: boolean;
  selectCommand: (command: ComposerCommand, confirmed?: boolean) => void;
  commandListRef: RefObject<HTMLDivElement>;
  matches: readonly ComposerCommand[];
}) {
  return (
    <section
      ref={commandPickerRef}
      className="terminal-composer-commands"
      role="group"
      tabIndex={-1}
      aria-label="Agent commands"
      aria-activedescendant={
        !replacement && selectedCommand
          ? `${pickerId}-${activeCommand}`
          : undefined
      }
      onKeyDown={commandKeyDown}
    >
      <div className="terminal-composer-command-heading">
        <span>Commands</span>
        <button
          type="button"
          aria-label="Dismiss commands"
          onMouseDown={keepTextareaFocus}
          onClick={closeCommandPicker}
        >
          <X size={14} />
        </button>
      </div>
      {replacement ? (
        <div
          className="terminal-composer-command-confirm"
          role="group"
          aria-label="Confirm draft replacement"
        >
          <p role="status">
            Replace the entire draft with {replacement.command.name}? Nothing
            will be sent.
          </p>
          <button
            type="button"
            ref={replacementCancelRef}
            tabIndex={0}
            onMouseDown={keepTextareaFocus}
            onClick={() => {
              setReplacement(null);
              focusPickerWithoutKeyboard();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={busy || composing}
            tabIndex={0}
            onMouseDown={keepTextareaFocus}
            onClick={() => selectCommand(replacement.command, true)}
          >
            Replace draft
          </button>
        </div>
      ) : (
        <>
          <div
            id={pickerId}
            ref={commandListRef}
            role="listbox"
            aria-label="Agent commands"
            className="terminal-composer-command-list"
          >
            {matches.map((command, index) => (
              <button
                type="button"
                role="option"
                id={`${pickerId}-${index}`}
                key={command.name}
                tabIndex={-1}
                aria-selected={index === activeCommand}
                disabled={busy || composing}
                onMouseDown={keepTextareaFocus}
                onClick={() => selectCommand(command)}
              >
                <span className="terminal-composer-command-usage">
                  <strong>{command.name}</strong>
                  {command.arguments ? (
                    <>
                      {" "}
                      <small>{command.arguments}</small>
                    </>
                  ) : null}
                </span>
                <span className="terminal-composer-command-description">
                  {command.description}
                </span>
              </button>
            ))}
          </div>
          {matches.length === 0 ? (
            <span className="terminal-composer-command-note" role="status">
              No matching commands. You can still type and send your own.
            </span>
          ) : null}
        </>
      )}
    </section>
  );
}
