import { useState } from "react";
import { worldLocalStorage } from "../../browserStorage";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { townPortrait } from "./townSprites";

export type TownCall = {
  agent: OfficeAgent;
  kind: "blocked" | "done";
  since: number;
  hostKey: string;
  hostLabel: string;
  roomKey: string;
  roomLabel: string;
};

const COLLAPSED_KEY = "townRailCollapsed:v1";
/** The rail lists at most this many agents; the rest are counted. */
const RAIL_LIMIT = 60;

export function readTownRailCollapsed() {
  try {
    return worldLocalStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function townAgo(since: number, now: number) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/**
 * Agents that need you (oldest first) and finished agents. Desktop groups them
 * by host and room in a collapsible rail; phones show a horizontal tray.
 */
export function TownRail({
  calls: allCalls,
  activeKey,
  now,
  onPeek,
  onOpen,
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
  calls: readonly TownCall[];
  activeKey: string | null;
  now: number;
  onPeek(key: string | null, anchor?: DOMRect): void;
  onOpen(key: string): void;
}) {
  const [closedHosts, setClosedHosts] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const waiting = allCalls.filter((call) => call.kind === "blocked").length;
  const calls = allCalls.slice(0, RAIL_LIMIT);
  const hidden = allCalls.length - calls.length;
  const toggle = () => {
    const next = !collapsed;
    onCollapsedChange(next);
    try {
      worldLocalStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // A remembered rail state is a convenience only.
    }
  };
  const chip = (call: TownCall, mini: boolean) => (
    <button
      key={call.agent.key}
      type="button"
      className={`town-call town-call-${call.kind}${mini ? " town-call-mini" : ""}${activeKey === call.agent.key ? " town-call-active" : ""}`}
      aria-label={`${call.agent.displayLabel}, ${call.kind === "blocked" ? "needs your input" : "finished"}, ${call.roomLabel}, ${call.hostLabel}${call.kind === "blocked" ? `, waiting ${townAgo(call.since, now)}` : ""}. Open chat.`}
      onMouseEnter={(event) =>
        onPeek(call.agent.key, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => onPeek(null)}
      onFocus={(event) =>
        onPeek(call.agent.key, event.currentTarget.getBoundingClientRect())
      }
      onClick={() => onOpen(call.agent.key)}
    >
      <img src={townPortrait(call.agent.key)} alt="" />
      <span>
        <b>{call.agent.displayLabel}</b>
        <small>
          {mini ? "" : `${call.roomLabel} · `}
          {call.kind === "blocked"
            ? `needs you · ${townAgo(call.since, now)}`
            : "finished"}
        </small>
      </span>
    </button>
  );
  const hosts = new Map<
    string,
    { label: string; rooms: Map<string, TownCall[]> }
  >();
  for (const call of calls) {
    let host = hosts.get(call.hostKey);
    if (!host)
      hosts.set(
        call.hostKey,
        (host = { label: call.hostLabel, rooms: new Map() }),
      );
    const room = host.rooms.get(call.roomKey) ?? [];
    room.push(call);
    host.rooms.set(call.roomKey, room);
  }
  return (
    <aside
      className={`town-rail${collapsed ? " town-rail-collapsed" : ""}`}
      aria-label="Agents that need you"
    >
      <div className="town-rail-head">
        <span>
          NEEDS YOU <b>{waiting}</b>
        </span>
        <button
          type="button"
          className="town-rail-toggle"
          aria-label={collapsed ? "Show the list" : "Hide the list"}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      {calls.length ? (
        <>
          {/* Phones: one flat, oldest-first strip. */}
          <div className="town-rail-strip">
            {calls.map((call) => chip(call, false))}
          </div>
          {/* Desktop: host › room › agents. */}
          <div className="town-rail-tree">
            {[...hosts].map(([hostKey, host]) => {
              const open = !closedHosts.has(hostKey);
              const count = [...host.rooms.values()]
                .flat()
                .filter((call) => call.kind === "blocked").length;
              return (
                <div key={hostKey} className="town-rail-host">
                  <button
                    type="button"
                    className="town-rail-host-toggle"
                    aria-expanded={open}
                    onClick={() =>
                      setClosedHosts((current) => {
                        const next = new Set(current);
                        if (open) next.add(hostKey);
                        else next.delete(hostKey);
                        return next;
                      })
                    }
                  >
                    <i aria-hidden="true">{open ? "▾" : "▸"}</i>
                    {host.label}
                    {count ? <small>{count}</small> : null}
                  </button>
                  {open
                    ? [...host.rooms].map(([roomKey, roomCalls]) => (
                        <div key={roomKey} className="town-rail-room">
                          <span className="town-rail-room-name">
                            {roomCalls[0]!.roomLabel}
                          </span>
                          {roomCalls.map((call) => chip(call, true))}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
          </div>
          {hidden ? <p className="town-rail-empty">+{hidden} more</p> : null}
        </>
      ) : (
        <p className="town-rail-empty">Nobody is waiting on you.</p>
      )}
    </aside>
  );
}
