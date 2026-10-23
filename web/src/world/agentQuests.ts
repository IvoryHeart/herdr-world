/**
 * Agents' quests for Town's desks and Board's cards, from the service's quest
 * read model (`agent_quest.list`). Each read is qualified by the leaf's own
 * connection and runtime generation, one call per connection.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { bridge, type ConnectionClient } from "../api";
import type { AgentQuest, Quest } from "../../../server/src/agent/quest";
import { deskClient } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

export type { Quest };

/** How often quests are reread while an agent is working. */
export const QUEST_REFRESH_MS = 15_000;

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

export function questMark(quest: Quest) {
  return {
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

/**
 * Quests by leaf ID for the given agents. They are read again when an agent
 * appears, leaves or changes status, and every QUEST_REFRESH_MS while one is
 * working (checklists change mid-turn). A session found only by guessing
 * from the pane's folder may be another agent's, so it shows no quest. A
 * connection that cannot answer keeps its last quests.
 */
export function useAgentQuests(
  leaves: readonly WorldLeafObject[],
  active = true,
): ReadonlyMap<string, Quest> {
  const [quests, setQuests] = useState(EMPTY);
  const shown = useRef(quests);
  shown.current = quests;
  // A large World has thousands of leaves: derive these once per leaves
  // list, not on every render of the view.
  const { agents, signature, working } = useMemo(() => {
    const agents: WorldLeafObject[] = [];
    const parts: string[] = [];
    let working = false;
    for (const leaf of leaves) {
      if (leaf.kind !== "agent") continue;
      agents.push(leaf);
      parts.push(
        `${leaf.id}\0${leaf.connectionId}\0${leaf.generation}\0${leaf.pane.pane_id}\0${leaf.status}`,
      );
      if (leaf.status === "working") working = true;
    }
    return { agents, signature: parts.join("\n"), working };
  }, [leaves]);
  const latest = useRef(agents);
  latest.current = agents;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    // One read at a time; a read already running answers a later request.
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      if (document.visibilityState !== "hidden") {
        // One call per connection and runtime generation.
        const groups = new Map<
          string,
          { client: ConnectionClient; group: WorldLeafObject[] }
        >();
        // Resolved once per group: every leaf in it shares the client.
        const refused = new Set<string>();
        for (const leaf of latest.current) {
          const key = `${leaf.connectionId}\0${leaf.generation}`;
          const entry = groups.get(key);
          if (entry) {
            entry.group.push(leaf);
            continue;
          }
          if (refused.has(key)) continue;
          const client = leafClient(leaf);
          if (client) groups.set(key, { client, group: [leaf] });
          else refused.add(key);
        }
        const next = new Map<string, Quest>();
        await Promise.all(
          [...groups.values()].map(async ({ client, group }) => {
            // Without an answer for a leaf, its last quest stays.
            const keep = (leaf: WorldLeafObject) => {
              const kept = shown.current.get(leaf.id);
              if (kept) next.set(leaf.id, kept);
            };
            try {
              const reply = (await client.call(
                "agent_quest.list",
                { pane_ids: group.map((leaf) => leaf.pane.pane_id) },
                8_000,
              )) as { quests?: AgentQuest[] } | null;
              if (!client.isCurrent()) return;
              if (!Array.isArray(reply?.quests)) {
                group.forEach(keep);
                return;
              }
              const byPane = new Map(
                reply.quests.map((entry) => [entry.pane_id, entry]),
              );
              for (const leaf of group) {
                const entry = byPane.get(leaf.pane.pane_id);
                if (!entry || entry.read_failed) keep(leaf);
                else if (entry.quest && entry.session_binding !== "guessed")
                  next.set(leaf.id, entry.quest);
              }
            } catch {
              group.forEach(keep);
            }
          }),
        );
        if (!cancelled)
          setQuests((current) =>
            JSON.stringify([...current]) === JSON.stringify([...next])
              ? current
              : next,
          );
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
    void read();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", shownAgain);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [signature, active, working]);
  return active ? quests : EMPTY;
}
