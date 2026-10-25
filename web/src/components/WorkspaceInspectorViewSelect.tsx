import { useState } from "react";
import {
  SquareTerminal,
  FolderTree,
  MessagesSquare,
  FileDiff,
  GitGraph,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./InterestButton.css";
import type { InspectorView } from "../workspaceResource";
export const INSPECTOR_TAB_LABELS: Partial<Record<InspectorView, string>> = {
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
  "changes",
  "files",
  "commits",
];

const MOBILE_VIEWS: readonly InspectorView[] = [
  "terminal",
  "files",
  "history",
  "changes",
];

/** Mobile's primary view switcher; attention belongs to the window menu. */
export function WorkspaceInspectorViewSelect({
  value,
  availableViews,
  historyAvailable,
  onChange,
}: {
  value: InspectorView;
  availableViews: readonly InspectorView[];
  historyAvailable: boolean;
  onChange(view: InspectorView): void;
}) {
  const [open, setOpen] = useState(false);
  const views = MOBILE_VIEWS.filter((view) => availableViews.includes(view));
  const icons = {
    terminal: SquareTerminal,
    files: FolderTree,
    history: MessagesSquare,
    changes: FileDiff,
    commits: GitGraph,
  };
  const Icon = icons[value];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="interest-button workspace-inspector-view-select"
          aria-label={`Inspector view: ${INSPECTOR_TAB_LABELS[value]}`}
          title={`View: ${INSPECTOR_TAB_LABELS[value]}`}
        >
          <Icon size={17} aria-hidden="true" />
        </button>
      </PopoverTrigger>
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
                  setOpen(false);
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
