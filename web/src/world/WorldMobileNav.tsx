import {
  Castle,
  LayoutDashboard,
  type LucideIcon,
  PanelsTopLeft,
  StickyNote,
} from "lucide-react";
import type { WorldView } from "./worldViewRouting";
import "./WorldMobileNav.css";

export const WORLD_VIEW_DESTINATIONS: readonly {
  view: WorldView;
  label: string;
  Icon: LucideIcon;
}[] = [
  { view: "town", label: "Town", Icon: Castle },
  { view: "board", label: "Board", Icon: StickyNote },
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
      {WORLD_VIEW_DESTINATIONS.map(({ view: destination, label, Icon }) => (
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
