import * as Popover from "@radix-ui/react-popover";
import { EllipsisVertical } from "lucide-react";
import { useRef, type Ref } from "react";

export function ChatComposerTools({
  buttonRef,
  disabled,
  commandsAvailable,
  onCommands,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  disabled: boolean;
  commandsAvailable: boolean;
  onCommands: () => void;
}) {
  const openingCommands = useRef(false);
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) openingCommands.current = false;
      }}
    >
      <Popover.Trigger asChild>
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="chat-composer-tools-popover"
          aria-label="Composer controls"
          side="top"
          align="end"
          sideOffset={6}
          onCloseAutoFocus={(event) => {
            if (openingCommands.current) event.preventDefault();
          }}
        >
          <Popover.Close asChild>
            <button
              type="button"
              onClick={() => {
                openingCommands.current = true;
                onCommands();
              }}
              disabled={!commandsAvailable}
            >
              Browse commands <kbd>/</kbd>
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
