import {
  Building2,
  LayoutDashboard,
  type LucideIcon,
  Network,
  PanelsTopLeft,
} from "lucide-react";
import type { WorldView } from "./worldViewRouting";
import "./WorldMobileNav.css";

const DESTINATIONS: readonly {
  view: WorldView;
  label: string;
  Icon: LucideIcon;
}[] = [
  { view: "office", label: "Office", Icon: Building2 },
  { view: "graph", label: "Graph", Icon: Network },
  { view: "desk", label: "Desk", Icon: LayoutDashboard },
  { view: "spaces", label: "Spaces", Icon: PanelsTopLeft },
];

export function worldViewLabel(view: WorldView) {
  return view[0].toUpperCase() + view.slice(1);
}

/**
 * The phone's bottom navigation bar for World's root screens, following the
 * platform pattern: three to five destinations, icon over label, the current
 * one marked. Detail screens (a terminal, Spaces) hide it and show Back.
 */
export function WorldMobileNav({
  view,
  onSelect,
}: {
  view: WorldView;
  onSelect: (view: WorldView) => void;
}) {
  return (
    <nav className="world-mobile-nav" aria-label="World views">
      {DESTINATIONS.map(({ view: destination, label, Icon }) => (
        <button
          key={destination}
          type="button"
          aria-current={destination === view ? "page" : undefined}
          onClick={() => {
            if (destination !== view) onSelect(destination);
          }}
        >
          <span className="world-mobile-nav-icon">
            <Icon size={22} aria-hidden />
          </span>
          <span className="world-mobile-nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
