import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { MoreHorizontal, SquareStack } from "lucide-react";
import "./MobileControls.css";

/**
 * Workspace-level mobile controls that terminal surfaces render inline: Tabs
 * beside the Message bar and in the Composer toolbar, and More for the
 * remaining workspace views. App owns the state; terminals only render it.
 */
export type MobileControls = {
  tabCount: number;
  /** Another tab in the focused workspace has an agent blocked on the user. */
  attention: boolean;
  tabsDisabled: boolean;
  tabsOpen: boolean;
  showTabs: () => void;
  moreOpen: boolean;
  toggleMore: () => void;
};

// A module store rather than a context: App publishes once per change and
// terminals subscribe, without wrapping App's (upstream-shared) markup.
let published: MobileControls | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublishMobileControls(controls: MobileControls | null) {
  const latest = useRef(controls);
  latest.current = controls;
  const key = controls
    ? [
        controls.tabCount,
        controls.attention,
        controls.tabsDisabled,
        controls.tabsOpen,
        controls.moreOpen,
      ].join("|")
    : "";
  useLayoutEffect(() => {
    const live = latest.current;
    published = live
      ? {
          ...live,
          showTabs: () => latest.current?.showTabs(),
          toggleMore: () => latest.current?.toggleMore(),
        }
      : null;
    notify();
  }, [key]);
  useLayoutEffect(
    () => () => {
      published = null;
      notify();
    },
    [],
  );
}

export function useMobileControls() {
  return useSyncExternalStore(
    subscribe,
    () => published,
    () => null,
  );
}

function tabsDescription(controls: MobileControls) {
  return (
    [
      controls.tabCount > 0 ? `${controls.tabCount} open` : "",
      controls.attention ? "an agent needs you" : "",
    ]
      .filter(Boolean)
      .join(", ") || undefined
  );
}

export function MobileTabsButton({ variant }: { variant: "row" | "chip" }) {
  const controls = useMobileControls();
  if (!controls) return null;
  return (
    <button
      type="button"
      className={`mobile-tabs-button mobile-tabs-${variant}`}
      aria-label="Show tabs"
      aria-description={tabsDescription(controls)}
      aria-pressed={controls.tabsOpen}
      disabled={controls.tabsDisabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={controls.showTabs}
    >
      <SquareStack size={variant === "row" ? 19 : 15} aria-hidden="true" />
      {variant === "chip" ? (
        <span aria-hidden="true">
          {controls.tabCount > 0 ? `${controls.tabCount} tabs` : "Tabs"}
        </span>
      ) : controls.tabCount > 0 ? (
        <span className="mobile-tabs-count" aria-hidden="true">
          {controls.tabCount}
        </span>
      ) : null}
      {controls.attention ? (
        <span className="mobile-tabs-attention" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export function MobileMoreButton() {
  const controls = useMobileControls();
  if (!controls) return null;
  return (
    <button
      type="button"
      className="mobile-more-button"
      aria-label="More"
      aria-expanded={controls.moreOpen}
      onMouseDown={(event) => event.preventDefault()}
      onClick={controls.toggleMore}
    >
      <MoreHorizontal size={19} aria-hidden="true" />
    </button>
  );
}
