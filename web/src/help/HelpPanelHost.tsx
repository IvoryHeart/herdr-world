import { useEffect, useRef, useState } from "react";
import type { WorldView } from "../world/worldViewRouting";
import { helpEntry } from "./entries";
import { HelpPanel } from "./HelpPanel";
import type { HelpEntry } from "./helpEntry";
import {
  HELP_TRY_EVENT,
  helpTryView,
  OPEN_HELP_EVENT,
  type HelpTab,
} from "./helpEvents";
import { spotlightHelpTarget, waitForHelpTarget } from "./helpTry";
import "./helpPanel.css";

/**
 * World's help: opens the panel on `openHelp(tab)` from any screen, and runs
 * Try. Try goes to the entry's view (Town, Board or Code), then spotlights its
 * control; when the control is not on screen, the panel says where it is.
 */
export function HelpPanelHost({
  view,
  mobile,
  onView,
}: {
  view: WorldView;
  mobile: boolean;
  onView(view: WorldView): void;
}) {
  const [panel, setPanel] = useState<{
    tab: HelpTab;
    missing: string | null;
  } | null>(null);
  const latest = useRef({ view, onView });
  latest.current = { view, onView };
  useEffect(() => {
    const onOpen = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: HelpTab }>).detail?.tab;
      setPanel({ tab: tab ?? "new", missing: null });
    };
    const onTry = (event: Event) => {
      const entry = helpEntry(
        (event as CustomEvent<{ id?: string }>).detail?.id ?? "",
      );
      if (entry) void tryEntry(entry);
    };
    const tryEntry = async (entry: HelpEntry) => {
      setPanel(null);
      // After the panel or greeting has closed and handed focus back.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const { view: current, onView: go } = latest.current;
      const destination = helpTryView(entry.place, current);
      if (destination) go(destination);
      const target = await waitForHelpTarget(entry.control);
      if (target) spotlightHelpTarget(target);
      else setPanel({ tab: entry.place, missing: entry.id });
    };
    window.addEventListener(OPEN_HELP_EVENT, onOpen);
    window.addEventListener(HELP_TRY_EVENT, onTry);
    return () => {
      window.removeEventListener(OPEN_HELP_EVENT, onOpen);
      window.removeEventListener(HELP_TRY_EVENT, onTry);
    };
  }, []);
  if (!panel) return null;
  return (
    <HelpPanel
      tab={panel.tab}
      mobile={mobile}
      missing={panel.missing}
      onTab={(tab) => setPanel({ tab, missing: null })}
      onTry={(entry) =>
        window.dispatchEvent(
          new CustomEvent(HELP_TRY_EVENT, { detail: { id: entry.id } }),
        )
      }
      onClose={() => setPanel(null)}
    />
  );
}
