import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import {
  TerminalAppearanceEditor,
  type TerminalAppearanceEditorProps,
} from "./TerminalAppearanceEditor";
import { AppearanceAvatar } from "./AppearanceAvatar";
import { appearanceFor } from "../../../shared/appearance";
import { useAppearanceDocument } from "./appearance";
import type { CSSProperties } from "react";
export function TerminalAppearanceButton(props: TerminalAppearanceEditorProps) {
  const document = useAppearanceDocument();
  const avatar = appearanceFor(document?.appearance, {
    connection_id: props.connectionId,
    kind: "pane",
    native_id: props.paneId,
    witness: [props.terminalId],
  })?.avatar;
  const hex = props.color.palette.find(
    (entry) => entry.id === props.color.current.id,
  )?.hex;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mobile-appearance-button"
          aria-label="Terminal appearance"
          title="Terminal appearance"
          style={{ "--tab-color": hex } as CSSProperties}
        >
          {avatar ? (
            <AppearanceAvatar id={avatar} />
          ) : (
            <span aria-hidden="true">◉</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={8}
        align="start"
        aria-label="Terminal appearance"
      >
        <TerminalAppearanceEditor {...props} />
      </PopoverContent>
    </Popover>
  );
}
