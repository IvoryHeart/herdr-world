import { Fragment } from "react";
import { AgentStatusIcon } from "../components/AgentStatusIcon";
import { useTabStripScroll } from "../components/useTabStripScroll";
import { useLayoutPreferences } from "../layoutPreferences";
import { type SpacesCoreChoice, type SpacesCoreStripGroup } from "./spacesCore";
import "../components/TabBar.css";
import "./spacesCoreTerminal.css";

/**
 * Spaces' tab strip on a herdr-core host (#1390), in the Herdr TUI strip's
 * place and look: one tab per live terminal World watches there, grouped
 * by World's rooms, the open one marked. Choosing a tab is World's own
 * presentation choice; herdr-core has no tabs or focus, so nothing is sent
 * to it. Like the TUI strip, a phone hides it while it has one tab and
 * scrolls it when it overflows.
 */
export function SpacesCoreStrip({
  groups,
  choice,
  onChoose,
}: {
  groups: readonly SpacesCoreStripGroup[];
  choice: SpacesCoreChoice;
  onChoose(choice: SpacesCoreChoice): void;
}) {
  const { mobile } = useLayoutPreferences();
  const tabs = groups.flatMap((group) => group.tabs);
  const stripScroll = useTabStripScroll({
    activeTabId: choice.nodeId,
    tabsKey: tabs.map((tab) => tab.choice.nodeId).join(" "),
  });
  if (mobile && tabs.length <= 1) return null;
  // Room names only tell rooms apart: one room needs none.
  const named = groups.filter((group) => group.label).length > 1;
  return (
    <div
      className="tabbar spaces-core-strip"
      data-terminal-owner={choice.connectionId}
      data-terminal-generation={choice.generation}
    >
      <div
        ref={stripScroll.ref}
        className="tabbar-tabs"
        role="tablist"
        aria-label="herdr-core terminals"
        data-overflow-start={stripScroll.overflow.start || undefined}
        data-overflow-end={stripScroll.overflow.end || undefined}
      >
        {groups.map((group) => (
          <Fragment key={group.id}>
            {named && group.label ? (
              <span
                className="spaces-core-strip-room"
                data-spaces-core-room={group.id}
              >
                {group.label}
              </span>
            ) : null}
            {group.tabs.map(({ choice: tab, leaf }) => {
              const open = tab.nodeId === choice.nodeId;
              const label = leaf?.label ?? tab.label;
              return (
                <button
                  key={tab.nodeId}
                  type="button"
                  role="tab"
                  aria-selected={open}
                  tabIndex={open ? 0 : -1}
                  data-tab-id={tab.nodeId}
                  data-spaces-core-tab={tab.nodeId}
                  className={`tabbar-tab spaces-core-tab ${open ? "is-active" : ""} ${leaf ? "" : "is-gone"}`}
                  title={
                    leaf
                      ? [label, group.label].filter(Boolean).join(" · ")
                      : `${label} is no longer on herdr-core`
                  }
                  disabled={!leaf && !open}
                  onClick={() => {
                    if (leaf && !open) onChoose(tab);
                  }}
                  onKeyDown={(event) => {
                    // Arrow keys move along the strip, as in any tab list.
                    const step =
                      event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0;
                    if (!step) return;
                    const buttons = [
                      ...event.currentTarget
                        .closest('[role="tablist"]')!
                        .querySelectorAll<HTMLButtonElement>(
                          '[role="tab"]:not(:disabled)',
                        ),
                    ];
                    const at = buttons.indexOf(event.currentTarget);
                    const next =
                      buttons[(at + step + buttons.length) % buttons.length];
                    if (!next || next === event.currentTarget) return;
                    event.preventDefault();
                    next.focus();
                    next.click();
                  }}
                >
                  {leaf?.kind === "agent" ? (
                    <span className="tabbar-agent-marker">
                      <AgentStatusIcon
                        agent={leaf.pane.agent ?? undefined}
                        status={leaf.status}
                      />
                    </span>
                  ) : null}
                  <span className="tabbar-name">{label}</span>
                  {leaf ? null : (
                    <span className="spaces-core-tab-gone">gone</span>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
