import { useId, useState } from "react";
import { worldLocalStorage } from "../../browserStorage";
import type { OfficeAgent, OfficeRosterEntry } from "../herdrOfficeProjection";
import type { WorldAsk } from "../worldAsks";
import { townPortrait } from "./townSprites";
import "./townAsks.css";

export type TownCall = {
  agent: OfficeAgent;
  kind: "blocked" | "done";
  since: number;
  hostKey: string;
  hostLabel: string;
  roomKey: string;
  roomLabel: string;
};

/**
 * The agent Next moves to: the next waiting agent after the current one in
 * the attention order, wrapping at the end, or the next finished one when
 * no other agent is waiting. Repeated Next visits every agent in turn.
 */
export function nextTownCall(
  calls: readonly TownCall[],
  currentKey: string | null,
): TownCall | null {
  const at = calls.findIndex((call) => call.agent.key === currentKey);
  const after = [...calls.slice(at + 1), ...calls.slice(0, Math.max(0, at))];
  return after.find((call) => call.kind === "blocked") ?? after[0] ?? null;
}

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

/** One open question from an agent (`herdr-world ask`), answered here. */
export function TownAsk({
  ask,
  now,
  onAnswer,
}: {
  ask: WorldAsk;
  now: number;
  onAnswer(id: string, text: string): Promise<string | null>;
}) {
  const questionId = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const problem = await onAnswer(ask.id, text.trim());
    setBusy(false);
    setError(problem);
  };
  return (
    <form
      className="town-ask"
      aria-label={`Question from ${ask.actor.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        void send(draft);
      }}
    >
      <small>{townAgo(ask.at, now)}</small>
      <p id={questionId}>
        <b>{ask.actor.label}</b>
        {ask.actor.verified ? "" : " (unverified)"} asks: {ask.question}
      </p>
      {ask.options.length ? (
        <div className="town-ask-options">
          {ask.options.map((option, index) => (
            <button
              key={`${index}:${option}`}
              type="button"
              aria-describedby={questionId}
              disabled={busy}
              onClick={() => void send(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <div className="town-ask-reply">
        <input
          value={draft}
          aria-label={`Your answer to ${ask.actor.label}`}
          aria-describedby={questionId}
          placeholder={ask.options.length ? "Or type an answer" : "Your answer"}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Answer
        </button>
      </div>
      {error ? <small role="alert">{error}</small> : null}
    </form>
  );
}

/**
 * Agents that need you (oldest first) and finished agents. Desktop groups them
 * by host and room in a collapsible rail; phones show a horizontal tray.
 * Questions agents asked come first.
 */
export function TownRail({
  calls: allCalls,
  needsYouCount,
  activeKey,
  now,
  onPeek,
  onOpen,
  collapsed,
  onCollapsedChange,
  asks = [],
  onAnswer = async () => null,
}: {
  needsYouCount: number;
  asks?: readonly WorldAsk[];
  onAnswer?(id: string, text: string): Promise<string | null>;
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
  const waiting = needsYouCount;
  const calls = allCalls.slice(0, RAIL_LIMIT);
  const hidden = allCalls.length - calls.length;
  // Nothing waiting: the rail steps out of the way entirely.
  if (!waiting) return null;
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
      aria-label="Items that need you"
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
      {asks.length && !collapsed ? (
        <div
          className="town-asks"
          role="region"
          aria-label="Questions for you"
          aria-live="polite"
        >
          {asks.map((ask) => (
            <TownAsk key={ask.id} ask={ask} now={now} onAnswer={onAnswer} />
          ))}
        </div>
      ) : null}
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
      ) : asks.length ? null : (
        <p className="town-rail-empty">Nobody is waiting on you.</p>
      )}
    </aside>
  );
}

/**
 * The call rail's entries, in attention order: blocked agents oldest first,
 * then unseen finishes. `since` remembers when each agent started waiting and
 * forgets agents that no longer wait.
 */
export function townCalls(
  roster: readonly OfficeRosterEntry[],
  since: Map<string, number>,
  unseenCompletions: readonly OfficeAgent[],
  entryOf: (agentKey: string) => OfficeRosterEntry | undefined,
): TownCall[] {
  const live = new Set<string>();
  const blocked: TownCall[] = [];
  for (const entry of roster) {
    const { agent } = entry;
    if (agent.semanticStatus !== "blocked" || agent.stale) continue;
    live.add(agent.key);
    if (!since.has(agent.key)) since.set(agent.key, Date.now());
    blocked.push({
      agent,
      kind: "blocked",
      since: since.get(agent.key)!,
      hostKey: entry.hostKey,
      hostLabel: entry.hostLabel,
      roomKey: entry.roomKey,
      roomLabel: entry.roomLabel,
    });
  }
  for (const key of [...since.keys()]) if (!live.has(key)) since.delete(key);
  blocked.sort(
    (a, b) => a.since - b.since || a.agent.key.localeCompare(b.agent.key),
  );
  const finished = unseenCompletions.flatMap((agent): TownCall[] => {
    const entry = entryOf(agent.key);
    return entry
      ? [
          {
            agent,
            kind: "done",
            since: Date.now(),
            hostKey: entry.hostKey,
            hostLabel: entry.hostLabel,
            roomKey: entry.roomKey,
            roomLabel: entry.roomLabel,
          },
        ]
      : [];
  });
  return [...blocked, ...finished];
}
