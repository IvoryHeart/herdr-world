import { useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useLayer } from "../layerStack";
import type { WorldView } from "./worldViewRouting";
import { WORLD_VIEW_DESTINATIONS, worldViewLabel } from "./WorldMobileNav";
import "./WorldViewPicker.css";

/**
 * Zen hides the topbar and the phone's bottom navigation, so the views stay
 * one choice away here: a row beside Exit Zen on desktop, and a corner button
 * with a short menu on a phone, where the thumb rests.
 */
export function WorldViewPicker({
  view,
  mobile,
  onSelect,
  onExitZen,
}: {
  view: WorldView;
  mobile: boolean;
  onSelect: (view: WorldView) => void;
  onExitZen: () => void;
}) {
  if (!mobile)
    return (
      <div className="world-view-picker" role="group" aria-label="World view">
        {WORLD_VIEW_DESTINATIONS.map(({ view: destination, label, Icon }) => (
          <button
            key={destination}
            type="button"
            aria-pressed={destination === view}
            aria-label={label}
            title={label}
            onClick={() => {
              if (destination !== view) onSelect(destination);
            }}
          >
            <Icon size={14} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  return (
    <PhoneViewPicker view={view} onSelect={onSelect} onExitZen={onExitZen} />
  );
}

function PhoneViewPicker({
  view,
  onSelect,
  onExitZen,
}: {
  view: WorldView;
  onSelect: (view: WorldView) => void;
  onExitZen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayer(open, () => setOpen(false), {
    element: () => menu.current,
    anchors: () => [trigger.current],
  });
  const current = WORLD_VIEW_DESTINATIONS.find(
    (destination) => destination.view === view,
  );
  const CurrentIcon = current?.Icon;
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="world-view-picker-phone">
      {open ? (
        <div
          ref={menu}
          className="world-view-picker-menu"
          role="menu"
          aria-label="World view"
        >
          {WORLD_VIEW_DESTINATIONS.map(({ view: destination, label, Icon }) => (
            <button
              key={destination}
              type="button"
              role="menuitemradio"
              aria-checked={destination === view}
              onClick={() =>
                choose(() => {
                  if (destination !== view) onSelect(destination);
                })
              }
            >
              <Icon size={18} aria-hidden />
              {label}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onExitZen)}
          >
            <Maximize2 size={18} aria-hidden />
            Show the bars
          </button>
        </div>
      ) : null}
      <button
        ref={trigger}
        type="button"
        className="world-view-picker-fab"
        aria-label={`Switch view, now ${worldViewLabel(view)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {CurrentIcon ? <CurrentIcon size={22} aria-hidden /> : null}
      </button>
    </div>
  );
}
