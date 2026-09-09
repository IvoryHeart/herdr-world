import { Building2, GitBranch, Network, SquareTerminal } from "lucide-react";

import { useCoreNavigation } from "./CoreNavigation";

const DESTINATIONS = [
  { id: "spaces", label: "Spaces", Icon: SquareTerminal },
  { id: "office", label: "Office", Icon: Building2 },
  { id: "graph", label: "Graph", Icon: Network },
  { id: "tree", label: "Tree", Icon: GitBranch },
] as const;

export function StageThemeSwitcher() {
  const { activeSurface, activeWorldTheme, navigate, navigateWorldTheme } = useCoreNavigation();
  const activeDestination = activeSurface.id === "spaces" ? "spaces" : activeWorldTheme.id;

  return (
    <nav className="stage-theme-switcher" aria-label="Theme switcher">
      {DESTINATIONS.map(({ id, label, Icon }) => {
        const active = id === activeDestination;
        return (
          <button
            key={id}
            type="button"
            aria-label={`Switch to ${label}`}
            aria-pressed={active}
            title={label}
            onClick={() => id === "spaces" ? navigate("spaces") : navigateWorldTheme(id)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
