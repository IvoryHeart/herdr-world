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
  const agents = leaves.filter((leaf) => leaf.kind === "agent");
  const signature = JSON.stringify(
    agents.map((leaf) => [
      leaf.id,
      leaf.connectionId,
      leaf.generation,
      leaf.pane.pane_id,
      leaf.status,
    ]),
  );
  const working = agents.some((leaf) => leaf.status === "working");
  const latest = useRef(agents);
  latest.current = agents;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    const read = async () => {
      if (document.visibilityState !== "hidden") {
        // One call per connection and runtime generation.
        const groups = new Map<
          string,
          { client: ConnectionClient; group: WorldLeafObject[] }
        >();
        for (const leaf of latest.current) {
          const client = leafClient(leaf);
          if (!client) continue;
          const key = JSON.stringify([leaf.connectionId, leaf.generation]);
          const entry = groups.get(key);
          if (entry) entry.group.push(leaf);
          else groups.set(key, { client, group: [leaf] });
        }
        const next = new Map<string, Quest>();
        await Promise.all(
          [...groups.values()].map(async ({ client, group }) => {
            try {
              const reply = (await client.call(
                "agent_quest.list",
                { pane_ids: group.map((leaf) => leaf.pane.pane_id) },
                8_000,
              )) as { quests?: AgentQuest[] } | null;
              if (!client.isCurrent() || !Array.isArray(reply?.quests)) return;
              const byPane = new Map(
                reply.quests.map((entry) => [entry.pane_id, entry]),
              );
              for (const leaf of group) {
                const entry = byPane.get(leaf.pane.pane_id);
                if (entry?.quest && entry.session_binding !== "guessed")
                  next.set(leaf.id, entry.quest);
              }
            } catch {
              for (const leaf of group) {
                const kept = shown.current.get(leaf.id);
                if (kept) next.set(leaf.id, kept);
              }
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
      if (!cancelled && working)
        timer = window.setTimeout(read, QUEST_REFRESH_MS);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [signature, active, working]);
  return active ? quests : EMPTY;
}
