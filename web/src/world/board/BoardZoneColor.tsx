import { memo, useEffect, useRef, useState } from "react";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import {
  TERMINAL_COLOR_HEX,
  TERMINAL_COLOR_PALETTE,
  TERMINAL_COLORS,
  type TerminalColor,
} from "../terminalColor";

/**
 * A host's colour on its zone label. A dense World has many zones, so each
 * is a plain button until clicked; only then does it mount the shared picker,
 * already open. Memoised, so a refresh that changes no colour skips it.
 */
export const BoardZoneColor = memo(function BoardZoneColor({
  colorKey,
  hostLabel,
  color,
  onColor,
}: {
  colorKey: string;
  hostLabel: string;
  color: TerminalColor | null;
  /** Stable across renders, so unchanged zones skip rendering. */
  onColor: (key: string, color: TerminalColor | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  // After a choice, focus returns to the plain button that replaced the picker.
  const chose = useRef(false);
  const plain = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (picking || !chose.current) return;
    chose.current = false;
    plain.current?.focus();
  }, [picking]);
  const label = `Colour of ${hostLabel}`;
  const current = color ?? "default";
  if (!picking)
    return (
      <button
        ref={plain}
        type="button"
        className="color-swatch-button board-zone-color"
        aria-label={`${label}: ${current}`}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setPicking(true)}
      >
        <i
          style={{
            background: color ? TERMINAL_COLOR_HEX[color] : "var(--board-zone)",
          }}
          aria-hidden="true"
        />
      </button>
    );
  return (
    <ColorSwatchButton
      className="board-zone-color"
      defaultHex="var(--board-zone)"
      defaultOpen
      label={label}
      palette={TERMINAL_COLOR_PALETTE}
      current={{ id: current, custom: color !== null }}
      onColor={(id) => {
        chose.current = true;
        setPicking(false);
        onColor(
          colorKey,
          TERMINAL_COLORS.includes(id as TerminalColor)
            ? (id as TerminalColor)
            : null,
        );
      }}
    />
  );
});
