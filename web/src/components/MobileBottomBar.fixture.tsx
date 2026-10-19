import { EllipsisVertical, SquareStack } from "lucide-react";
import { useEffect, type Ref } from "react";
import { focusIfUnchanged } from "./dialogFocus";
import { blurActiveInput } from "../activeTerminalInput";

// Test fixture for shared input-target transitions and shell navigation.
// World production navigation uses MobileControls.
export function MobileBottomBarFixture({
  inputRef,
  tabCount,
  attention,
  tabsOpen,
  moreOpen,
  onTabsOpenChange,
  onMoreOpenChange,
}: {
  inputRef: Ref<HTMLDivElement>;
  tabCount: number;
  attention: boolean;
  tabsOpen: boolean;
  moreOpen: boolean;
  onTabsOpenChange: (open: boolean) => void;
  onMoreOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!moreOpen) return;
    const menu = document.getElementById("mobile-more-options");
    menu?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onMoreOpenChange(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      const source = document.activeElement;
      if (source === document.body || (source && menu?.contains(source)))
        focusIfUnchanged(document.querySelector(".mobile-appbar-more"), source);
    };
  }, [moreOpen, onMoreOpenChange]);
  return (
    <div className="mobile-bottom-bar" aria-label="Mobile controls">
      <div className="mobile-bottom-input" ref={inputRef} />
      <nav className="mobile-appbar" aria-label="Workspace navigation">
        <button
          type="button"
          className="mobile-appbar-tabs"
          aria-label="Show tabs"
          aria-description={`${tabCount} open${attention ? ", an agent needs you" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={tabsOpen}
          onPointerDown={blurActiveInput}
          onClick={() => {
            onMoreOpenChange(false);
            onTabsOpenChange(!tabsOpen);
          }}
        >
          <SquareStack size={21} aria-hidden="true" />
          <span
            className="mobile-appbar-count"
            data-attention={attention || undefined}
            aria-hidden="true"
          >
            {tabCount}
          </span>
        </button>
        <button
          type="button"
          className="mobile-appbar-more"
          aria-label="More options"
          aria-expanded={moreOpen}
          aria-controls="mobile-more-options"
          onPointerDown={blurActiveInput}
          onClick={() => {
            onTabsOpenChange(false);
            onMoreOpenChange(!moreOpen);
          }}
        >
          <EllipsisVertical size={21} aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
