import type { Database } from "bun:sqlite";
import { listPullRequests, observe } from "../gate/observe";
import type { GateInput } from "../gate/predicate";
import { getMeta, setMeta } from "./store";
import {
  parseGitHubResponse,
  record,
} from "../../../server/src/sources/github";

export const SAFETY_MS = 10 * 60_000;

export function budgetIntervals(
  remaining: number,
  options: { interval: number; busyInterval: number },
) {
  return remaining < 1500
    ? {
        interval: Math.max(600, options.interval),
        busyInterval: Math.max(120, options.busyInterval),
      }
    : { interval: options.interval, busyInterval: options.busyInterval };
}

type Observation = { stamp: string; at: number; input: GateInput };
const key = (repo: string, pr: number) => `github:observation:${repo}:${pr}`;

/** Also qualifies the round policy's REST reply cache against this observation. */
export function observationStamp(db: Database, repo: string, pr: number) {
  const raw = getMeta(db, key(repo, pr));
  return raw ? (JSON.parse(raw) as Observation) : null;
}

/** One list read, then only changed or expired detail. Explicit gate reads bypass this. */
export function cachedObserve(
  db: Database,
  options: Parameters<typeof observe>[0],
  read: typeof observe = observe,
  policy: {
    mergeOnly?: boolean;
    persist?: boolean;
    eligible?: (input: GateInput) => boolean;
  } = {},
): GateInput[] {
  const { run, config, numbers, now } = options;
  const nodes = listPullRequests(run, config.repo, numbers);
  const kept = new Map<number, GateInput>();
  const changed = nodes.filter((node) => {
    const previous = observationStamp(db, config.repo, Number(node.number));
    const stamp = JSON.stringify([config, node]);
    if (
      previous?.stamp === stamp &&
      now >= previous.at &&
      now - previous.at < SAFETY_MS
    ) {
      kept.set(Number(node.number), structuredClone(previous.input));
      return false;
    }
    const item = parseGitHubResponse({
      data: { authored: { nodes: [node] } },
    })[0];
    const labels = Array.isArray(record(node.labels).nodes)
      ? (record(node.labels).nodes as { name: string }[]).map(
          (label) => label.name,
        )
      : [];
    const deferred: GateInput = {
      number: Number(node.number),
      state: "OPEN",
      item,
      labels,
      history: [],
      historyComplete: false,
      requiredChecks: null,
      attempts: [],
      copies: {},
      hold: null,
      waived: [],
      outcomes: {},
      executions: {},
      overlap: null,
      readAt: now,
    };
    if (
      policy.mergeOnly &&
      node.state === "OPEN" &&
      (node.isDraft ||
        item?.checks !== "pass" ||
        node.mergeable !== "MERGEABLE" ||
        labels.includes("on-hold") ||
        policy.eligible?.(deferred) === false)
    ) {
      kept.set(Number(node.number), deferred);
      return false;
    }
    return true;
  });
  const fresh = changed.length ? read({ ...options, nodes: changed }) : [];
  for (const input of fresh) {
    const node = changed.find((node) => node.number === input.number)!;
    if (policy.persist !== false)
      setMeta(
        db,
        key(config.repo, input.number),
        JSON.stringify({
          stamp: JSON.stringify([config, node]),
          at: now,
          input,
        } satisfies Observation),
      );
    kept.set(input.number, input);
  }
  return nodes.map((node) => kept.get(Number(node.number))!);
}
