/**
 * Agents' quests for Town's desks and Board's cards, from the service's quest
 * read model (`agent_quest.list`). Each read is qualified by the leaf's own
 * connection and runtime generation, one call per connection.
 */

import { useEffect, useRef, useState } from "react";
import { bridge, type ConnectionClient } from "../api";
import type { AgentQuest, Quest } from "../../../server/src/agent/quest";
import { deskClient } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

export type { Quest };

/** How often quests are reread while an agent is working. */
export const QUEST_REFRESH_MS = 15_000;
/**
 * The least time between reads. Statuses can flip many times a second in a
 * busy World; each flip asks for a read, and they share one.
 */
export const QUEST_MIN_GAP_MS = 5_000;
/** The most agents one read asks about. */
export const QUEST_PANE_LIMIT = 200;

const EMPTY: ReadonlyMap<string, Quest> = new Map();

export const QUEST_SOURCE_LABELS: Record<Quest["source"], string> = {
  todo: "Checklist",
  plan: "Plan",
  goal: "Goal",
  loop: "Loop",
};

/** A short progress label: "2/5", "Loop ×3", or the source's name. */
export function questProgressText(quest: Quest) {
  if (quest.progress.total > 0)
    return `${quest.progress.done}/${quest.progress.total}`;
  if (quest.source === "loop" && quest.iterations)
    return `Loop ×${quest.iterations}`;
  return QUEST_SOURCE_LABELS[quest.source];
}

/** What Town's pennant shows for a quest. */
export function questMark(quest: Quest) {
  return {
    title: quest.title,
    progress: questProgressText(quest),
    done: quest.progress.done,
    total: quest.progress.total,
    status: quest.status,
  };
}

/** The step the agent is on: the active one, else the first not done. */
export function questCurrentStep(quest: Quest) {
  return (
    quest.steps.find((step) => step.status === "active") ??
    quest.steps.find((step) => step.status !== "done") ??
    null
  );
}

const leafClient = (leaf: WorldLeafObject): ConnectionClient | null =>
  deskClient(
    (candidate: WorldLeafObject) =>
      bridge.connection(candidate.connectionId, candidate.generation),
    leaf,
  );

/** A shown quest and the session it was read from. */
type ShownQuest = {
  quest: Quest;
  /** The service's fingerprint of the session, when it binds one. */
  session: string | null;
  /** The World's fingerprint of the pane's session when it was read. */
  leafSession: string | undefined;
};

/**
 * Quest reads for a set of agents, without React. Reads may overlap: only
 * the latest one started is applied, so a slow earlier answer never
 * replaces a newer one. A pane that cannot be read just now keeps its last
 * quest only while it is still the same session; a pane reused by another
 * session never shows the previous one's quest.
 */
export class AgentQuestReads {
  private started = 0;
  private shown: ReadonlyMap<string, ShownQuest> = new Map();

  constructor(
    private readonly clientFor: (
      leaf: WorldLeafObject,
    ) => ConnectionClient | null = leafClient,
  ) {}

  quests(): ReadonlyMap<string, Quest> {
    return new Map([...this.shown].map(([id, shown]) => [id, shown.quest]));
  }

  /**
   * Read the first QUEST_PANE_LIMIT agents among the leaves. Resolves to
   * whether the shown quests changed and whether one of the agents is
   * working, or null when a later read started meanwhile.
   */
  async read(
    leaves: readonly WorldLeafObject[],
  ): Promise<{ changed: boolean; working: boolean } | null> {
    const sequence = ++this.started;
    let working = false;
    // One call per connection and runtime generation, its client resolved
    // once: every leaf in a group shares it.
    const groups = new Map<
      string,
      { client: ConnectionClient; group: WorldLeafObject[] }
    >();
    const refused = new Set<string>();
    let asked = 0;
    for (const leaf of leaves) {
      if (leaf.kind !== "agent") continue;
      if (asked++ >= QUEST_PANE_LIMIT) break;
      if (leaf.status === "working") working = true;
      const key = `${leaf.connectionId}\0${leaf.generation}`;
      const entry = groups.get(key);
      if (entry) {
        entry.group.push(leaf);
        continue;
      }
      if (refused.has(key)) continue;
      const client = this.clientFor(leaf);
      if (client) groups.set(key, { client, group: [leaf] });
      else refused.add(key);
    }
    const prior = this.shown;
    const next = new Map<string, ShownQuest>();
    // Without an answer, the last quest stays only for the same session:
    // the World's fingerprint must not have changed, and the service's
    // (when it gives one) must match the one the quest was read from.
    const keep = (leaf: WorldLeafObject, session?: string | null) => {
      const last = prior.get(leaf.id);
      if (!last || last.leafSession !== leaf.agentSessionFingerprint) return;
      const same = session
        ? session === last.session
        : last.leafSession !== undefined;
      if (same) next.set(leaf.id, last);
    };
    await Promise.all(
      [...groups.values()].map(async ({ client, group }) => {
        try {
          const reply = (await client.call(
            "agent_quest.list",
            { pane_ids: group.map((leaf) => leaf.pane.pane_id) },
            8_000,
          )) as { quests?: AgentQuest[] } | null;
          if (!client.isCurrent()) return;
          if (!Array.isArray(reply?.quests)) {
            group.forEach((leaf) => keep(leaf));
            return;
          }
          const byPane = new Map(
            reply.quests.map((entry) => [entry.pane_id, entry]),
          );
          for (const leaf of group) {
            const entry = byPane.get(leaf.pane.pane_id);
            if (!entry) keep(leaf);
            else if (entry.read_failed) keep(leaf, entry.session_fingerprint);
            else if (entry.quest && entry.session_binding !== "guessed")
              next.set(leaf.id, {
                quest: entry.quest,
                session: entry.session_fingerprint ?? null,
                leafSession: leaf.agentSessionFingerprint,
              });
          }
        } catch {
          group.forEach((leaf) => keep(leaf));
        }
      }),
    );
    if (sequence !== this.started) return null;
    const changed =
      JSON.stringify([...prior].map(([id, shown]) => [id, shown.quest])) !==
      JSON.stringify([...next].map(([id, shown]) => [id, shown.quest]));
    this.shown = next;
    return { changed, working };
  }
}

/**
 * Quests by leaf ID for the given agents. They are read again when the
 * leaves change (at most once per QUEST_MIN_GAP_MS), and every
 * QUEST_REFRESH_MS while one is working (checklists change mid-turn). A
 * read asks for the first QUEST_PANE_LIMIT agents only: a dense World has
 * millions of panes, and render does no work per leaf. A session found only
 * by guessing from the pane's folder may be another agent's, so it shows no
 * quest.
 */
export function useAgentQuests(
  leaves: readonly WorldLeafObject[],
  active = true,
): ReadonlyMap<string, Quest> {
  const [quests, setQuests] = useState(EMPTY);
  const reads = useRef<AgentQuestReads | null>(null);
  reads.current ??= new AgentQuestReads();
  const latest = useRef(leaves);
  latest.current = leaves;
  const lastRead = useRef(0);
  // A read that started for earlier leaves still answers for those leaves,
  // so a change of leaves does not discard it (only unmounting, or a later
  // read, does); otherwise every change during a read would wait out
  // QUEST_MIN_GAP_MS.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const quests = reads.current!;
    let cancelled = false;
    let timer: number | undefined;
    // One read at a time; a read already running answers a later request.
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      lastRead.current = Date.now();
      let working = false;
      if (document.visibilityState !== "hidden") {
        const result = await quests.read(latest.current);
        working = result?.working ?? false;
        if (result?.changed && mounted.current) setQuests(quests.quests());
      }
      reading = false;
      if (!cancelled && working)
        timer = window.setTimeout(read, QUEST_REFRESH_MS);
    };
    // A hidden page skips reads; catch up when it is shown again.
    const shownAgain = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      void read();
    };
    document.addEventListener("visibilitychange", shownAgain);
    const wait = lastRead.current + QUEST_MIN_GAP_MS - Date.now();
    if (wait > 0) timer = window.setTimeout(read, wait);
    else void read();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", shownAgain);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [leaves, active]);
  return active ? quests : EMPTY;
}
