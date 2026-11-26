import { useRef, useState, type Ref, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import {
  ChevronDown,
  SquareTerminal,
  FolderTree,
  MessagesSquare,
  FileDiff,
  GitGraph,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./InterestButton.css";
import type { InspectorView } from "../workspaceResource";
const INSPECTOR_TAB_LABELS: Partial<Record<InspectorView, string>> = {
  history: "Chat",
  terminal: "Terminal",
  changes: "Changes",
  files: "Files",
  commits: "Commits",
};

/** The Inspector's views as its top selector shows them, Chat first. */
export const INSPECTOR_TAB_ORDER: readonly InspectorView[] = [
  "history",
  "terminal",
  "files",
  "changes",
  "commits",
];

/**
 * The Inspector's one view menu, for a bar too narrow for its tabs: a phone,
 * or a desktop window narrowed until the tabs no longer fit (#1361). Its
 * trigger shows the current view; `bar` gives it the look of the active tab,
 * so the chip left in a narrow desktop bar is the menu. Attention belongs to
 * the window menu.
 */
export function WorkspaceInspectorViewSelect({
  value,
  views,
  historyAvailable,
  bar = false,
  onChange,
}: {
  value: InspectorView;
  /** The views to offer, in the tab bar's order. */
  views: readonly InspectorView[];
  historyAvailable: boolean;
  bar?: boolean;
  onChange(view: InspectorView): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const icons = {
    terminal: SquareTerminal,
    files: FolderTree,
    history: MessagesSquare,
    changes: FileDiff,
    commits: GitGraph,
  };
  const Icon = icons[value];
  const trigger = (
    <PopoverTrigger asChild>
      <button
        ref={triggerRef}
        type="button"
        className={
          bar
            ? "is-active workspace-inspector-view-select is-bar"
            : "interest-button workspace-inspector-view-select"
        }
        aria-label={`Inspector view: ${INSPECTOR_TAB_LABELS[value]}`}
        title={`View: ${INSPECTOR_TAB_LABELS[value]}`}
      >
        <Icon size={bar ? 14 : 17} aria-hidden="true" />
        {bar ? <ChevronDown size={11} aria-hidden="true" /> : null}
      </button>
    </PopoverTrigger>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {bar ? (
        // Inside the tab bar's frame, so every skin draws it as a tab.
        <div className="workspace-inspector-tabs workspace-inspector-view-menu">
          {trigger}
        </div>
      ) : (
        trigger
      )}
      <PopoverContent
        className="interest-popover"
        align="end"
        collisionPadding={8}
      >
        <div
          className="interest-choices"
          role="group"
          aria-label="Inspector views"
        >
          {views.map((view) => {
            const ViewIcon = icons[view];
            return (
              <button
                type="button"
                key={view}
                className="interest-choice"
                data-view={view}
                aria-pressed={value === view}
                disabled={view === "history" && !historyAvailable}
                onClick={() => {
                  if (view === "history" && !historyAvailable) return;
                  // Let the shared layer restore focus before Chat captures
                  // its new opening origin. Escape/Back keep their policy.
                  flushSync(() => setOpen(false));
                  if (view === "history")
                    triggerRef.current?.focus({ preventScroll: true });
                  onChange(view);
                }}
              >
                <ViewIcon size={15} aria-hidden="true" />
                <span>
                  <b>{INSPECTOR_TAB_LABELS[view]}</b>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Keep secondary controls after the four primary views. */
export function WorkspaceInspectorSecondaryControls({
  commitsAvailable,
  view,
  commitsRef,
  onViewChange,
  onKeyDown,
}: {
  commitsAvailable: boolean;
  view: InspectorView;
  commitsRef: Ref<HTMLButtonElement>;
  onViewChange(view: InspectorView): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  return (
    <>
      {commitsAvailable ? (
        <div
          className="workspace-inspector-tabs"
          role="tablist"
          aria-label="Additional Inspector views"
        >
          <button
            ref={commitsRef}
            type="button"
            role="tab"
            aria-label="Commits"
            title="Commits"
            aria-selected={view === "commits"}
            tabIndex={view === "commits" ? 0 : -1}
            className={view === "commits" ? "is-active" : ""}
            onClick={() => onViewChange("commits")}
            onKeyDown={onKeyDown}
          >
            <GitGraph size={14} aria-hidden="true" />
            <span className="workspace-inspector-tab-label">Commits</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
