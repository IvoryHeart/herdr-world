import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { CircleHelp, Command, Maximize2, Server } from "lucide-react";
import { openCommandBox } from "../commandBoxKey";
import { helpTabForView, openHelp } from "../help/helpEvents";
import { shortcutTitle, useShortcutPreferences } from "../shortcutPreferences";
import { useLayer } from "../layerStack";
import {
  HostsFilterOptions,
  type HostsControlProps,
  hostsSelectionLabel,
  useConnectionManager,
} from "./HostsControl";
import type { WorldView } from "./worldViewRouting";
import { useHostGrouping } from "./useHostGroups";
import { WORLD_VIEW_DESTINATIONS, worldViewLabel } from "./WorldMobileNav";
import "./WorldViewPicker.css";

/**
 * Zen hides the topbar and the phone's bottom navigation, so the views stay
 * one choice away here: a row beside Exit Zen on desktop, and a corner button
 * with a short menu on a phone, where the thumb rests. The phone's menu also
 * holds Hosts, which a desktop reaches from the topbar that slides back over
 * Exit Zen.
 */
export function WorldViewPicker({
  view,
  mobile,
  onSelect,
  onExitZen,
  extra,
  search,
  hosts,
}: {
  view: WorldView;
  mobile: boolean;
  onSelect: (view: WorldView) => void;
  onExitZen: () => void;
  /** Beside the views, such as the Needs you counter. */
  extra?: ReactNode;
  /**
   * The view's search, which lives in the hidden topbar otherwise: beside the
   * views on desktop, and in the bottom corner opposite the views on a phone.
   */
  search?: ReactNode;
  /** The topbar's Hosts filter, offered in the phone's corner menu. */
  hosts?: HostsControlProps;
}) {
  const searchSlot = search ? (
    <div className={`world-zen-search${mobile ? " is-phone" : ""}`}>
      {search}
    </div>
  ) : null;
  if (!mobile)
    return (
      <>
        {searchSlot}
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
          <CommandBoxButton />
          <button
            type="button"
            className="world-view-picker-command world-view-picker-help"
            data-help="world.help"
            aria-label="What can I do here?"
            title="What can I do here?"
            onClick={() => openHelp(helpTabForView(view))}
          >
            <CircleHelp size={14} aria-hidden />
          </button>
        </div>
      </>
    );
  return (
    <>
      {searchSlot}
      {extra ? <div className="world-view-picker-extra">{extra}</div> : null}
      <PhoneViewPicker
        view={view}
        onSelect={onSelect}
        onExitZen={onExitZen}
        hosts={hosts}
      />
    </>
  );
}

function PhoneViewPicker({
  view,
  onSelect,
  onExitZen,
  hosts,
}: {
  view: WorldView;
  onSelect: (view: WorldView) => void;
  onExitZen: () => void;
  hosts?: HostsControlProps;
}) {
  // The views menu, or the Hosts filter it opens in the same corner: one
  // layer, so Escape, Back or a press outside closes either.
  const [panel, setPanel] = useState<"views" | "hosts" | null>(null);
  const open = panel !== null;
  const setOpen = (value: boolean) => setPanel(value ? "views" : null);
  const manager = useConnectionManager();
  const grouping = useHostGrouping();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayer(open, () => setPanel(null), {
    element: () => menu.current,
    anchors: () => [trigger.current],
  });
  const current = WORLD_VIEW_DESTINATIONS.find(
    (destination) => destination.view === view,
  );
  const CurrentIcon = current?.Icon;
  // A menu takes focus on the current view and moves with the arrow keys,
  // Home and End; Tab leaves it closed, and Escape or Back closes it through
  // the layer stack. The Hosts panel takes focus on its first control.
  useEffect(() => {
    if (!panel) return;
    menu.current
      ?.querySelector<HTMLElement>(
        panel === "hosts"
          ? "button, input"
          : '[aria-checked="true"], [role^="menuitem"]',
      )
      ?.focus();
  }, [panel]);
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
  // The Hosts panel moves with Tab between its own controls, and Tab past its
  // last control (or Shift+Tab before its first) leaves it closed, as Tab
  // leaves the views menu.
  const onHostsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      menu.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      ) ?? [],
    );
    const edge = controls[event.shiftKey ? 0 : controls.length - 1];
    if (!edge || document.activeElement === edge) setPanel(null);
  };
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="world-view-picker-phone">
      {panel === "hosts" && hosts ? (
        <div
          ref={menu}
          className="world-view-picker-menu world-view-picker-hosts"
          role="group"
          aria-label="Hosts filter"
          onKeyDown={onHostsKeyDown}
        >
          <HostsFilterOptions
            connections={hosts.connections}
            ids={hosts.ids}
            onChange={hosts.onChange}
            onManage={() => choose(manager.open)}
          />
          {hosts.explanation ? <p role="status">{hosts.explanation}</p> : null}
        </div>
      ) : open ? (
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
          {hosts ? (
            <button
              type="button"
              role="menuitem"
              aria-haspopup="true"
              data-help="world.phone-hosts"
              onClick={() => setPanel("hosts")}
            >
              <Server size={18} aria-hidden />
              Hosts
              <span className="world-view-picker-detail">
                {hostsSelectionLabel(hosts.connections, hosts.ids, grouping)}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            data-help="world.command-box"
            // After the menu hands focus back, so the box keeps it.
            onClick={() =>
              choose(() => window.setTimeout(() => openCommandBox()))
            }
          >
            <Command size={18} aria-hidden />
            Find or act
          </button>
          <button
            type="button"
            role="menuitem"
            data-help="world.help"
            onClick={() => choose(() => openHelp(helpTabForView(view)))}
          >
            <CircleHelp size={18} aria-hidden />
            What can I do here?
          </button>
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
        // Try spotlights this button for help entries inside its menu; the
        // menu's every data-help control is listed (WorldViewPicker.test.tsx).
        data-help-opens="world.help world.phone-hosts world.command-box"
        aria-label={`Switch view, now ${worldViewLabel(view)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {CurrentIcon ? <CurrentIcon size={22} aria-hidden /> : null}
      </button>
      {manager.dialog}
    </div>
  );
}

/** The command box, with its key, beside the views (#782). */
function CommandBoxButton() {
  useShortcutPreferences();
  const title = shortcutTitle("Find or act", "command.menu");
  return (
    <button
      type="button"
      className="world-view-picker-command"
      data-help="world.command-box"
      aria-label={title}
      title={title}
      onClick={() => openCommandBox()}
    >
      <Command size={14} aria-hidden />
    </button>
  );
}
