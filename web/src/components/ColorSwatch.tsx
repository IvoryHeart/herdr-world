import { useState } from "react";
import { cn } from "../utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./ColorSwatch.css";

/**
 * The terminal colour picker, one component wherever a terminal's colour is
 * chosen: Spaces' tab menu, the terminal window's menu, the terminal header
 * and Town's peek. The host supplies the palette and stores the choice.
 */
export type ColorChoice = { id: string; hex: string };
export type ColorValue = { id: string; custom: boolean };

/** A palette and a reset to the default colour. */
export function ColorSwatches({
  palette,
  current,
  onColor,
  label,
}: {
  palette: readonly ColorChoice[];
  current: ColorValue;
  /** A palette colour, or `null` to reset to the default. */
  onColor: (id: string | null) => void;
  label: string;
}) {
  return (
    <div className="color-swatches" role="group" aria-label={label}>
      {palette.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="color-swatch"
          style={{ background: entry.hex }}
          aria-label={`Colour ${entry.id}`}
          aria-pressed={current.id === entry.id}
          onClick={() => onColor(entry.id)}
        />
      ))}
      <button
        type="button"
        className="color-swatches-reset"
        disabled={!current.custom}
        onClick={() => onColor(null)}
      >
        Default colour
      </button>
    </div>
  );
}

/**
 * The current colour as a small button that opens `ColorSwatches` in a
 * popover, a layer on the shared stack.
 */
export function ColorSwatchButton({
  palette,
  current,
  onColor,
  label,
  text,
  className,
  defaultHex,
  defaultOpen = false,
}: {
  palette: readonly ColorChoice[];
  current: ColorValue;
  onColor: (id: string | null) => void;
  label: string;
  /** The dot's colour when `current` is not a palette colour (a default). */
  defaultHex?: string;
  /** Visible text beside the colour, as in a menu; the dot alone otherwise. */
  text?: string;
  className?: string;
  /** Open on mount, for a caller that mounts the picker only when asked. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hex =
    palette.find((entry) => entry.id === current.id)?.hex ?? defaultHex;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("color-swatch-button", className)}
          aria-label={`${label}: ${current.id}`}
          aria-haspopup="dialog"
          title={label}
        >
          <i style={{ background: hex }} aria-hidden="true" />
          {text ? <span>{text}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="color-swatch-popover"
        align="start"
        collisionPadding={8}
      >
        <ColorSwatches
          palette={palette}
          current={current}
          label={label}
          onColor={(id) => {
            setOpen(false);
            onColor(id);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
