import { useRef } from "react";
import {
  pullRequestAttention,
  stalledAt,
  type PullRequestAttention,
  type PullRequestAuthor,
} from "../../../shared/pullRequests";
import type { WorkItem } from "../../../shared/worldSources";

export const clockTime = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Why each of your pull requests needs you (Ready to merge; Stalled: CI red,
 * agent idle), for Reception, the Town summary and the Work lens. It
 * remembers when it first saw each one stalled, so a turn ending doesn't
 * flicker the reason in and out.
 */
export function usePullRequestAttention(
  entries: readonly { item: WorkItem; authors: PullRequestAuthor[] }[],
  now = Date.now(),
): ReadonlyMap<string, PullRequestAttention> {
  const stalled = useRef(new Map<string, number>());
  return pullRequestAttentionAt(entries, now, stalled.current);
}

/** The pure step: `seen` keeps when each pull request was first seen stalled. */
export function pullRequestAttentionAt(
  entries: readonly { item: WorkItem; authors: PullRequestAuthor[] }[],
  now: number,
  seen: Map<string, number>,
): ReadonlyMap<string, PullRequestAttention> {
  const result = new Map<string, PullRequestAttention>();
  const current = new Set<string>();
  for (const { item, authors } of entries) {
    if (stalledAt(item, authors) !== null) {
      current.add(item.key);
      if (!seen.has(item.key)) seen.set(item.key, now);
    }
    const attention = pullRequestAttention(
      item,
      authors,
      now,
      seen.get(item.key) ?? null,
      clockTime,
    );
    if (attention) result.set(item.key, attention);
  }
  for (const key of seen.keys()) if (!current.has(key)) seen.delete(key);
  return result;
}
