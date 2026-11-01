import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
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
  extra,
}: {
  view: WorldView;
  mobile: boolean;
  onSelect: (view: WorldView) => void;
  onExitZen: () => void;
  /** Beside the views, such as the Needs you counter. */
  extra?: ReactNode;
}) {
  if (!mobile)
    return (
      <div className="world-view-picker" role="group" aria-label="World view">
        {extra}
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
    <>
      {extra ? <div className="world-view-picker-extra">{extra}</div> : null}
      <PhoneViewPicker view={view} onSelect={onSelect} onExitZen={onExitZen} />
    </>
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
  // A menu takes focus on the current view and moves with the arrow keys,
  // Home and End; Tab leaves it closed, and Escape or Back closes it through
  // the layer stack.
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLButtonElement>(
        '[aria-checked="true"], [role^="menuitem"]',
      )
      ?.focus();
  }, [open]);
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ??
        [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  };
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
          onKeyDown={onMenuKeyDown}
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
