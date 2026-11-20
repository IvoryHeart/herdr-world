import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../components/CloseButton";
import { focusDialogElement } from "../components/dialogFocus";
import { useLayer } from "../layerStack";
import { HELP_ENTRIES, helpEntry } from "./entries";
import { HelpEntryCard } from "./HelpEntryCard";
import {
  compareVersions,
  HELP_PLACE_LABELS,
  HELP_PLACES,
  type HelpEntry,
} from "./helpEntry";
import type { HelpTab } from "./helpEvents";
import "./helpPanel.css";

export const HELP_SITE_URL = "https://herdr.world/help/";

const TABS: readonly HelpTab[] = ["new", ...HELP_PLACES];

function tabLabel(tab: HelpTab) {
  return tab === "new" ? "What's new" : HELP_PLACE_LABELS[tab];
}

/** A tab's entries: a place's own, or every entry newest first. */
export function helpTabEntries(
  tab: HelpTab,
  entries: readonly HelpEntry[] = HELP_ENTRIES,
) {
  return tab === "new"
    ? [...entries].sort((a, b) => compareVersions(b.since, a.since))
    : entries.filter((entry) => entry.place === tab);
}

/**
 * "What can I do here?": every help declaration (web/src/help/entries.ts)
 * for one place, or what is new, each with its picture and Try.
 */
export function HelpPanel({
  tab,
  mobile,
  missing,
  onTab,
  onTry,
  onClose,
}: {
  tab: HelpTab;
  mobile: boolean;
  /** Try did not find this entry's control on screen. */
  missing: string | null;
  onTab(tab: HelpTab): void;
  onTry(entry: HelpEntry): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, onClose, { element: () => ref.current });
  useEffect(() => focusDialogElement(ref.current), []);
  const missed = missing ? helpEntry(missing) : null;
  const entries = helpTabEntries(tab);
  let version: string | null = null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={ref}
        className={`modal help-panel${mobile ? " is-phone" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="What can I do here?"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>What can I do here?</h2>
          <CloseButton label="Close help" onClick={onClose} />
        </div>
        <div className="help-panel-tabs" role="tablist" aria-label="Help">
          {TABS.map((each) => (
            <button
              key={each}
              type="button"
              role="tab"
              aria-selected={each === tab}
              onClick={() => onTab(each)}
            >
              {tabLabel(each)}
            </button>
          ))}
        </div>
        {missed ? (
          <p className="help-panel-missing" role="status">
            {missed.title} is not on this screen. Where: {missed.where}.
          </p>
        ) : null}
        <ul className="help-panel-entries" role="tabpanel">
          {entries.map((entry) => {
            const heading =
              tab === "new" && entry.since !== version ? entry.since : null;
            version = entry.since;
            return [
              heading ? (
                <li key={`v${heading}`} className="help-panel-version">
                  New in {heading}
                </li>
              ) : null,
              <HelpEntryCard
                key={entry.id}
                entry={entry}
                mobile={mobile}
                onTry={onTry}
              />,
            ];
          })}
        </ul>
        <p className="help-panel-more">
          <a href={HELP_SITE_URL} target="_blank" rel="noopener noreferrer">
            All help on herdr.world
          </a>
        </p>
      </div>
    </div>,
    document.body,
  );
}
