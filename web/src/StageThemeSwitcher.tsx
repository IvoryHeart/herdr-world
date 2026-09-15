import { Building2, GitBranch, Network, SquareTerminal } from "lucide-react";

import type { ToolbarPrimaryView } from "./SidebarToolbar";

const DESTINATIONS = [
  { id: "spaces", label: "Spaces", Icon: SquareTerminal },
  { id: "office", label: "Office", Icon: Building2 },
  { id: "graph", label: "Graph", Icon: Network },
  { id: "tree", label: "Tree", Icon: GitBranch },
] as const;

export function StageThemeSwitcher({
  activeView,
  onView,
}: {
  activeView: string;
  onView: (view: ToolbarPrimaryView) => void;
}) {
  return (
    <nav className="stage-theme-switcher" aria-label="Theme switcher">
      {DESTINATIONS.map(({ id, label, Icon }) => {
        const active = id === activeView;
        return (
          <button
            key={id}
            type="button"
            aria-label={`Switch to ${label}`}
            aria-pressed={active}
            title={label}
            onClick={() => onView(id)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
