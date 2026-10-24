import { EllipsisVertical } from "lucide-react";
import { useState, type Ref } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

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
  const [open, setOpen] = useState(false);
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
      </PopoverContent>
    </Popover>
  );
}
