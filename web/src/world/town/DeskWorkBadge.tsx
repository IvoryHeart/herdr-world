import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { actionablePullRequest } from "../../../../shared/pullRequests";
import { useLayer } from "../../layerStack";
import { PullRequestCard } from "../PullRequestCard";
import { useWorldSources } from "../worldSources";
import type { TownDeskBadge as Badge } from "./townBadges";
import { TownHudContext } from "./useTownHud";
import "./deskWorkBadge.css";

/**
 * The work badge on a desk's nameplate. For one of your open pull requests it
 * opens the pull request card (readiness and its verbs) in a popover beside
 * the badge, or as a sheet on a phone; any other badge links to its item.
 */
export function DeskWorkBadge({
  badge,
  deskLabel,
}: {
  badge: Badge | undefined;
  deskLabel: string;
}) {
  const snapshot = useWorldSources();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  if (!badge) return null;
  const item = snapshot.items.find((entry) => entry.key === badge.itemKey);
  if (!item || !actionablePullRequest(item))
    return (
      <a
        className="town-desk-badge"
        data-tone={badge.tone}
        href={badge.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${badge.text} at ${deskLabel}`}
      >
        {badge.text}
      </a>
    );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="town-desk-badge town-desk-badge-button"
        data-tone={badge.tone}
        aria-label={`${badge.text} at ${deskLabel}: pull request`}
        aria-expanded={open}
        // The desk under the nameplate takes presses for selection and drags.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {badge.text}
      </button>
      {open
        ? createPortal(
            <BadgePopover anchor={anchor} onClose={() => setOpen(false)}>
              <PullRequestCard item={item} compact />
            </BadgePopover>,
            document.body,
          )
        : null}
    </>
  );
}

const GAP = 6;
const MARGIN = 8;
const PHONE = 640;

function BadgePopover({
  anchor,
  onClose,
  children,
}: {
  anchor: { current: HTMLElement | null };
  onClose(): void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );
  useLayer(true, onClose, {
    element: () => panel.current,
    anchors: () => [anchor.current],
  });
  // Beside the badge, kept on screen, following it as the camera zooms and
  // pans (each frame Town draws) and as the window resizes; a phone shows it
  // as a bottom sheet.
  const hud = useContext(TownHudContext);
  useLayoutEffect(() => {
    const follow = () => {
      const at = anchor.current?.getBoundingClientRect();
      const size = panel.current?.getBoundingClientRect();
      if (at && size && window.innerWidth >= PHONE) {
        const left = Math.min(
          Math.max(MARGIN, at.left),
          window.innerWidth - size.width - MARGIN,
        );
        const below = at.bottom + GAP;
        const top =
          below + size.height <= window.innerHeight - MARGIN
            ? below
            : Math.max(MARGIN, at.top - GAP - size.height);
        setPlace((current) =>
          current?.left === left && current.top === top
            ? current
            : { left, top },
        );
      }
    };
    follow();
    const stop = hud?.onFrame(follow);
    window.addEventListener("resize", follow);
    // Its card can change size as it loads.
    const resized = new ResizeObserver(follow);
    if (panel.current) resized.observe(panel.current);
    return () => {
      stop?.();
      window.removeEventListener("resize", follow);
      resized.disconnect();
    };
  }, [anchor, hud]);
  // Keyboard users land in the card once it is shown (it stays hidden until
  // placed); closing returns focus to the badge.
  const shown = place !== null || window.innerWidth < PHONE;
  useEffect(() => {
    if (shown)
      panel.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
  }, [shown]);
  return (
    <div
      ref={panel}
      className="town-badge-popover"
      role="dialog"
      aria-label="Pull request"
      data-placed={place ? "" : undefined}
      style={place ? { left: place.left, top: place.top } : undefined}
    >
      {children}
    </div>
  );
}
