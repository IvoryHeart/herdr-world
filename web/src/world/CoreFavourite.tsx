import { Star } from "lucide-react";
import { store } from "../store";
import { type CoreShared, useCoreFavourite } from "./coreSeen";
import "./coreFavourite.css";

/** Without a view's own toast, a failure shows as World's notice. */
const notice = (message: string) => store.notify({ kind: "error", message });

/**
 * The favourite of a herdr-core agent, shared with Herdr's apps
 * (`herdr.pinned`). Separate from a pinned desk or board card, which stay
 * World's own.
 */
export function CoreFavouriteButton({
  target,
  className,
  disabled = false,
  notify,
}: {
  target: CoreShared;
  className: string;
  disabled?: boolean;
  notify?: (message: string) => void;
}) {
  const { favourite, pending, toggle } = useCoreFavourite(
    target,
    notify ?? notice,
  );
  return (
    <button
      type="button"
      className={`${className}${favourite ? " is-favourite" : ""}`}
      aria-pressed={favourite}
      aria-label={favourite ? "Remove from favourites" : "Add to favourites"}
      title={
        favourite
          ? "Favourite in Herdr's apps. Click to remove it"
          : "Add to favourites in Herdr's apps"
      }
      disabled={disabled || pending}
      onClick={toggle}
    >
      <Star
        size={15}
        aria-hidden="true"
        fill={favourite ? "currentColor" : "none"}
      />
    </button>
  );
}
