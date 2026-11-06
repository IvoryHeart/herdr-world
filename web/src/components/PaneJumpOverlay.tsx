import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { passwordManagerIgnore } from "../passwordManagerIgnore";
import { type PaneJumpEntry, paneJumpEntryKey } from "../paneJump";
import { agentClass } from "../utils";
import { AgentIcon } from "./AgentIcon";
import "./PaneJumpOverlay.css";

/**
 * The recent pane switcher, and Pane Search over every live pane once K is
 * pressed, with other servers' agents labelled by their server.
 */
export function PaneJumpOverlay({
  entries,
  selectedIndex,
  search,
  onSearchChange,
  onSelectIndex,
  onCommit,
  onClose,
}: {
  entries: PaneJumpEntry[];
  selectedIndex: number;
  search: string | null;
  onSearchChange: (value: string) => void;
  onSelectIndex: (index: number) => void;
  onCommit: (index: number) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searching = search !== null;
  const selectedEntry = entries[selectedIndex];
  const selectedPaneId = selectedEntry
    ? paneJumpEntryKey(selectedEntry)
    : undefined;

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, selectedPaneId]);
  useEffect(() => {
    if (searching) searchInputRef.current?.focus();
  }, [searching]);

  if (entries.length === 0 && !searching) return null;
  const listId = "pane-jump-list";
  return (
    <div className="pane-jump-backdrop">
      <div
        className="pane-jump-popover"
        role="listbox"
        aria-label="Recent panes"
      >
        <div className="pane-jump-head">
          <strong>{searching ? "Find Pane" : "Switch Pane"}</strong>
          <span>
            {searching
              ? "Filters every open pane. Use Up / Down and Enter"
              : "K to search; Enter or release modifier to switch"}
          </span>
        </div>
        {searching ? (
          <div className="pane-jump-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className="pane-jump-search"
              value={search}
              spellCheck={false}
              autoComplete="off"
              {...passwordManagerIgnore}
              placeholder="Workspace, tab, server, directory, or agent"
              role="combobox"
              aria-label="Search panes"
              aria-expanded={true}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                selectedPaneId
                  ? `${listId}-${encodeURIComponent(selectedPaneId)}`
                  : undefined
              }
              onChange={(event) => onSearchChange(event.target.value)}
              onBlur={() => onClose()}
            />
          </div>
        ) : null}
        {entries.length === 0 ? (
          <p className="pane-jump-empty" role="status">
            No panes match this search.
          </p>
        ) : null}
        <div
          className="pane-jump-list"
          id={listId}
          role="listbox"
          aria-label={searching ? "Matching panes" : "Recent panes"}
        >
          {entries.map((entry, index) => (
            <button
              key={paneJumpEntryKey(entry)}
              id={`${listId}-${encodeURIComponent(paneJumpEntryKey(entry))}`}
              ref={index === selectedIndex ? selectedItemRef : undefined}
              type="button"
              tabIndex={-1}
              className={`pane-jump-item ${
                index === selectedIndex ? "is-selected" : ""
              } ${entry.current ? "is-current" : ""}`}
              role="option"
              aria-selected={index === selectedIndex}
              onPointerEnter={() => onSelectIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onCommit(index)}
            >
              {entry.agent ? (
                <span className="pane-jump-agent-identity">
                  <AgentIcon agent={entry.agent} compact />
                  <span
                    className={`pane-jump-status status-${entry.agentStatus ?? "unknown"}`}
                  />
                </span>
              ) : null}
              <span className="pane-jump-text">
                <span className="pane-jump-title-line">
                  <strong>{entry.title}</strong>
                  {entry.serverLabel ? (
                    <span className="pane-jump-server-badge">
                      {entry.serverLabel}
                    </span>
                  ) : null}
                  {entry.current ? (
                    <span className="pane-jump-current-badge">Current</span>
                  ) : null}
                  {entry.agentStatus ? (
                    <span
                      className={`${agentClass(entry.agentStatus)} pane-jump-agent-status`}
                    >
                      {entry.agentStatus}
                    </span>
                  ) : null}
                </span>
                <span className="pane-jump-subtitle">
                  {entry.agent ? (
                    <>
                      <span className="pane-jump-agent-name">
                        {entry.agent}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  <span className="pane-jump-tab" title={entry.tabLabel}>
                    {entry.tabLabel}
                  </span>
                  <span className="pane-jump-id" title={entry.paneId}>
                    {" · "}
                    {entry.paneLabel}
                  </span>
                  {entry.cwd ? (
                    <span className="pane-jump-cwd" title={entry.cwd}>
                      {" · "}
                      {entry.cwd}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
