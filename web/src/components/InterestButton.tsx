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
};

const CHOICES: { id: Interest; label: string; hint: string }[] = [
  { id: "watching", label: "Watching", hint: "Chimes when it needs you" },
  { id: "muted", label: "Muted", hint: "No chimes; still in reception" },
  { id: "focused", label: "Focused", hint: "Only focused agents chime" },
];

const ICONS = { watching: Eye, muted: BellOff, focused: Crosshair };

export function InterestButton({
  current,
  onInterest,
  className,
}: InterestChoice & { className?: string }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[current];
  const label = CHOICES.find((choice) => choice.id === current)!.label;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("interest-button", className)}
          data-interest={current}
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
          {CHOICES.map((choice) => {
            const ChoiceIcon = ICONS[choice.id];
            return (
              <button
                key={choice.id}
                type="button"
                className="interest-choice"
                aria-pressed={current === choice.id}
                onClick={() => {
                  setOpen(false);
                  if (choice.id !== current) onInterest(choice.id);
                }}
              >
                <ChoiceIcon size={15} aria-hidden="true" />
                <span>
                  <b>{choice.label}</b>
                  <small>{choice.hint}</small>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
