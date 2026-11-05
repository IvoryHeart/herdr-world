import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import "./worldLoader.css";

/**
 * Real waiting time after which a wait says it is taking longer than usual:
 * twice the slowest measured agent start (4.8 s over 17 runs), rounded up.
 */
export const WORLD_LOADER_LONGER_MS = 10_000;

export const worldLoaderLonger = (
  since: number,
  now: number,
  after = WORLD_LOADER_LONGER_MS,
) => now - since >= after;

/**
 * World's waiting line: what World is doing, from state it already has (a
 * request in flight, a window waiting for Chat). It shows no percentage or
 * countdown; "taking longer" is the real time since the wait began. Reduced
 * motion stops the icon; the text carries the state either way.
 */
export function WorldLoader({
  label,
  longerLabel,
  detail,
  since,
  live = true,
  actions,
  className,
}: {
  label: ReactNode;
  /** Shown instead of `label` once the wait passes WORLD_LOADER_LONGER_MS. */
  longerLabel: ReactNode;
  detail?: ReactNode;
  /** When the wait began (Date.now()). */
  since: number;
  /** False inside a container that is already a live status region. */
  live?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const longer = worldLoaderLonger(since, now);
  useEffect(() => {
    if (longer) return;
    // One timer for the one change this line can make by itself.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, since + WORLD_LOADER_LONGER_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [since, longer]);
  return (
    <div
      className={`world-loader${longer ? " is-longer" : ""}${className ? ` ${className}` : ""}`}
      aria-busy="true"
    >
      <LoaderCircle
        size={16}
        className="world-loader-spinner"
        aria-hidden="true"
      />
      <div className="world-loader-copy" role={live ? "status" : undefined}>
        <b>{longer ? longerLabel : label}</b>
        {detail ? <small>{detail}</small> : null}
      </div>
      {actions}
    </div>
  );
}
