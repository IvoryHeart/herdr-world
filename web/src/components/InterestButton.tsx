import { BellOff, Crosshair, Eye } from "lucide-react";
import { useState } from "react";
import type { Interest } from "../../../shared/interest";
import { cn } from "../utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./InterestButton.css";

/**
 * An agent's interest (shared/interest.ts) as a small header button that opens
 * the three choices. Interest only gates chimes: a muted agent's questions and
 * results still reach reception.
 */

export type InterestChoice = {
  current: Interest;
  onInterest(next: Interest): void;
  /** Another agent is focused, so a watched agent stays quiet for now. */
  quiet?: boolean;
  /** Agent choices distinguish a forced Watch from inherited Default. */
  override?: Interest | null;
  onDefault?(): void;
  description?: string;
};

const CHOICES: { id: Interest; label: string; hint: string }[] = [
  { id: "watching", label: "Watching", hint: "Chimes as usual" },
  { id: "muted", label: "Muted", hint: "No chimes; still in reception" },
  { id: "focused", label: "Focused", hint: "Only focused agents chime" },
];

const ICONS = { watching: Eye, muted: BellOff, focused: Crosshair };

export function InterestButton({
  current,
  onInterest,
  quiet = false,
  override,
  onDefault,
  description,
  className,
}: InterestChoice & { className?: string }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[current];
  const held = quiet && current === "watching";
  const label = `${description ?? CHOICES.find((choice) => choice.id === current)!.label}${held ? ", quiet while an agent is focused" : ""}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("interest-button", className)}
          data-interest={current}
          data-quiet={held || undefined}
          aria-label={`Interest: ${label}`}
          aria-haspopup="dialog"
          title={`Interest: ${label}`}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="interest-popover"
        align="start"
        collisionPadding={8}
      >
        <div className="interest-choices" role="group" aria-label="Interest">
          {onDefault && (
            <button
              type="button"
              className="interest-choice"
              aria-pressed={override === null}
              onClick={() => {
                setOpen(false);
                onDefault();
              }}
            >
              <Eye size={15} aria-hidden="true" />
              <span>
                <b>Default (from groups)</b>
                <small>Use group Focus or Mute; otherwise watch</small>
              </span>
            </button>
          )}
          {CHOICES.map((choice) => {
            const ChoiceIcon = ICONS[choice.id];
            return (
              <button
                key={choice.id}
                type="button"
                className="interest-choice"
                aria-pressed={
                  onDefault ? override === choice.id : current === choice.id
                }
                onClick={() => {
                  setOpen(false);
                  if (
                    choice.id !== current ||
                    (onDefault && override !== choice.id)
                  )
                    onInterest(choice.id);
                }}
              >
                <ChoiceIcon size={15} aria-hidden="true" />
                <span>
                  <b>
                    {onDefault && choice.id === "watching"
                      ? "Watch"
                      : choice.label}
                  </b>
                  <small>
                    {quiet && choice.id === "watching"
                      ? "Quiet while an agent is focused"
                      : choice.hint}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
