import { useState } from "react";
import { BellOff, Crosshair, Eye } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import type { GroupView } from "../../../../shared/groupViews";
import type { GroupInterest } from "../../../../shared/interest";
import { useAgentInterest } from "../useAgentInterest";
import { sharedBoardStore, useBoardDocument } from "../board/boardDocument";
import "../../components/InterestButton.css";

/** Viewer preference for stored Teams/Pods. Room/Desk controls stay hidden in v1. */
export function GroupInterestButton({
  group,
  onError,
}: {
  group: GroupView;
  onError(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const store = sharedBoardStore();
  const { document } = useBoardDocument(store);
  const effective = useAgentInterest(store);
  if (!group.stored || (group.kind !== "team" && group.kind !== "pod"))
    return null;
  const intent = document?.layout.group_interest;
  const current =
    intent && Object.prototype.hasOwnProperty.call(intent, group.id)
      ? intent[group.id]
      : null;
  const empty =
    current === "focused" &&
    !group.terminals.some(
      (terminal) =>
        effective.interestOf(terminal.connectionId, terminal.terminalId) ===
        "focused",
    );
  const label = `${current === "focused" ? "Focused" : current === "muted" ? "Muted" : "Default"}${empty ? " (no one online)" : ""}`;
  const Icon =
    current === "focused" ? Crosshair : current === "muted" ? BellOff : Eye;
  const choose = async (interest: GroupInterest | null) => {
    setOpen(false);
    if (!document) return;
    const error = await store.patch(
      [{ op: "group.interest", id: group.id, interest }],
      document.revision,
    );
    if (error) onError(error);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="interest-button group-interest-button"
          type="button"
          aria-label={`Group interest: ${label}`}
          title={`${label} · ${group.kind === "pod" ? "Pod" : "Team"} · ${group.name}. Individual choices win; group Focus beats Mute. Focus counts reachable effective-focused members only.`}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="interest-popover" align="start">
        <div
          className="interest-choices"
          role="group"
          aria-label="Group interest"
        >
          {(
            [
              {
                value: null,
                label: "Default",
                hint: "No group claim; watch unless another choice applies",
                Icon: Eye,
              },
              {
                value: "muted",
                label: "Muted",
                hint: "Mute members unless an individual choice or group Focus overrides",
                Icon: BellOff,
              },
              {
                value: "focused",
                label: "Focused",
                hint: "Add reachable members to focus; Needs you still reaches reception",
                Icon: Crosshair,
              },
            ] as const
          ).map((choice) => (
            <button
              key={choice.label}
              type="button"
              className="interest-choice"
              aria-pressed={current === choice.value}
              onClick={() => void choose(choice.value)}
            >
              <choice.Icon size={15} />
              <span>
                <b>{choice.label}</b>
                <small>{choice.hint}</small>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
