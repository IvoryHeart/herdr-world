import { useId, useState } from "react";
import type { OfficeAgent, OfficeRosterEntry } from "../herdrOfficeProjection";
import { askerName, type WorldAsk } from "../worldAsks";
import type { TownAsker } from "./townAskers";
import "./townAsks.css";

/** The same room/host wording in Town's peek and Summary. */
export function townLocation(
  entry: Pick<OfficeRosterEntry, "roomLabel" | "hostLabel"> | undefined,
) {
  return entry ? `${entry.roomLabel} · ${entry.hostLabel}` : "";
}

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

export function townAgo(since: number, now: number) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/** The owner's ways to handle questions, shared by the rail and Summary. */
export type TownAskActions = {
  /** Each question's asker, by question ID (townAskers). */
  askers: ReadonlyMap<string, TownAsker>;
  answer(id: string, text: string): Promise<string | null>;
  /** Close a question without answering it. */
  dismiss(id: string): Promise<string | null>;
  /** Open the asking agent, or the asking terminal when it has no agent. */
  open(asker: TownAsker): void;
};

/** One open question from an agent (`herdr-world ask`), answered here. */
export function TownAsk({
  ask,
  now,
  actions,
}: {
  ask: WorldAsk;
  now: number;
  actions: TownAskActions;
}) {
  const questionId = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asker = actions.askers.get(ask.id);
  const name = asker?.name ?? askerName(ask);
  const who = `${name}${ask.actor.verified ? "" : " (unverified)"}`;
  const act = async (close: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    const problem = await close();
    setBusy(false);
    setError(problem);
  };
  const send = (text: string) =>
    text.trim()
      ? act(() => actions.answer(ask.id, text.trim()))
      : Promise.resolve();
  return (
    <form
      className="town-ask"
      aria-label={`Question from ${who}`}
      onSubmit={(event) => {
        event.preventDefault();
        void send(draft);
      }}
    >
      <small>{townAgo(ask.at, now)}</small>
      <p id={questionId}>
        <b>{name}</b>
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
          aria-label={`Your answer to ${who}`}
          aria-describedby={questionId}
          placeholder={ask.options.length ? "Or type an answer" : "Your answer"}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Answer
        </button>
      </div>
      <div className="town-ask-actions">
        {asker?.key ? (
          <button
            type="button"
            aria-label={`Open ${name}`}
            onClick={() => actions.open(asker)}
          >
            Open agent
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Dismiss the question from ${who} without answering`}
          disabled={busy}
          onClick={() => void act(() => actions.dismiss(ask.id))}
        >
          Dismiss
        </button>
      </div>
      {error ? <small role="alert">{error}</small> : null}
    </form>
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

/** The shared unreviewed finishes, using Town's current finished/seen overlay. */
export function unseenTownCompletions(
  roster: readonly OfficeRosterEntry[],
  seen: ReadonlySet<string>,
): OfficeAgent[] {
  return roster
    .filter(
      ({ agent }) =>
        agent.semanticStatus === "done" &&
        agent.deskKey !== null &&
        !seen.has(agent.key),
    )
    .map(({ agent }) => agent)
    .sort(
      (left, right) =>
        Number(right.canOpenInSpaces) - Number(left.canOpenInSpaces) ||
        left.displayLabel.localeCompare(right.displayLabel) ||
        left.key.localeCompare(right.key),
    );
}
