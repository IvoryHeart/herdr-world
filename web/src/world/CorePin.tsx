import { Pin } from "lucide-react";
import { useCoreAgentPin } from "./corePins";
import "./corePin.css";

/**
 * A herdr-core agent's pin in a peek: its desk and card pin, the same pin
 * Herdr's apps show (`herdr.pinned`). Quiet: it never wears attention colour.
 */
export function CorePinButton({
  target,
  className,
  disabled = false,
  notify,
}: {
  target: { connectionId: string; terminal: string };
  className: string;
  disabled?: boolean;
  notify?: (message: string) => void;
}) {
  const { pinned, pending, toggle } = useCoreAgentPin(target, notify);
  return (
    <button
      type="button"
      className={`${className}${pinned ? " is-pinned" : ""}`}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin" : "Pin"}
      title={
        pinned
          ? "Pinned here and in Herdr's apps: its desk and card keep their place. Click to unpin"
          : "Pin: its desk and card keep their place, and Herdr's apps list it first"
      }
      disabled={disabled || pending}
      onClick={toggle}
    >
      <Pin
        size={15}
        aria-hidden="true"
        fill={pinned ? "currentColor" : "none"}
      />
    </button>
  );
}
