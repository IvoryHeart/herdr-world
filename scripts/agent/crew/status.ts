import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { shortSha } from "../../../shared/pullRequests";
import type { GateInput } from "../gate/predicate";
import { currentInputs, latestInput, openStore } from "../gate/store";
import { type CrewSettings, inScope, isOnHold, loadSettings } from "./plan";
import { type Seat, unrostered, type WatcherCode } from "./seats";
import {
  actionsIn,
  metaWithPrefix,
  recentActions,
  recentRuns,
  runsSince,
  type StoredRun,
} from "./store";

/**
 * `agent:crew status`: held PRs, open and recent actions, recent runs,
 * reviewer tokens, unrostered seats and a watcher on old code.
 */
export function status(
  crew: Database,
  out: (text: string) => void,
  now: number,
  settings: CrewSettings | null,
  held: GateInput[] = [],
) {
  if (settings) {
    const heldPrs = held
      .filter(
        (input) =>
          input.state === "OPEN" && inScope(input, settings) && isOnHold(input),
      )
      .sort((a, b) => a.number - b.number);
    out(`${heldPrs.length} held pull request(s) (as last read)`);
    for (const input of heldPrs)
      out(`  #${input.number}\t${input.item?.title ?? ""}`.trimEnd());
  } else out("held pull requests unknown: no crew pass or configuration yet");
  const open = actionsIn(crew, ["pending", "running"]);
  out(`${open.length} open action(s)`);
  for (const entry of open)
    out(
      `  ${entry.state}\t#${entry.pr} ${entry.kind} ${entry.target}${entry.detail ? ` (${entry.detail})` : ""}`,
    );
  out("recent actions");
  for (const entry of recentActions(crew, 10))
    out(
      `  ${entry.state}\t#${entry.pr} ${entry.kind} ${entry.target} ${Math.round((now - entry.updatedAt) / 60_000)} min ago`,
    );
  out("recent runs");
  for (const entry of recentRuns(crew, 10))
    out(
      `  run ${entry.id}\t#${entry.pr} ${entry.reviewer} @${shortSha(entry.head)} ${entry.finishedAt === null ? "running" : `exit ${entry.exitCode}`}${entry.usage ? ` usage ${entry.usage}` : ""}`,
    );
}

/**
 * `status` for the gate directory `dir`. The ledger shows without a
 * configuration or a recorded pass; held PRs need both.
 */
export function showStatus(
  crew: Database,
  dir: string,
  out: (text: string) => void,
  now: number,
  extra: {
    live?: Seat[];
    hours?: number;
    alive?: (pid: number) => boolean;
  } = {},
) {
  const gate = openStore(join(dir, "gate.sqlite"));
  try {
    const seen = currentInputs(gate);
    const configPath = join(dir, "config.json");
    const settings = existsSync(configPath) ? loadSettings(configPath) : null;
    status(crew, out, now, seen && settings, seen ?? []);
    const hours = extra.hours ?? 24;
    spend(
      runsSince(crew, now - hours * 3_600_000),
      (pr) => latestInput(gate, pr)?.labels ?? [],
      hours,
      out,
    );
    const missing = settings
      ? unrostered(extra.live ?? [], settings.roster)
      : [];
    if (missing.length) out(`seats not in the roster: ${missing.join(", ")}`);
    // Each live watcher's versions come from its own checkout, whichever
    // checkout `status` runs from.
    for (const { key, value } of metaWithPrefix(crew, "watcher:")) {
      const pid = Number(key.slice("watcher:".length));
      const code = JSON.parse(value) as WatcherCode;
      if (code.loaded !== code.disk && (extra.alive ?? (() => false))(pid))
        out(
          `watcher ${pid} runs older crew code than its checkout; restart \`agent:crew -- watch\``,
        );
    }
  } finally {
    gate.close();
  }
}

/** A run's tokens: Codex's total, or Claude's input, output and cache. */
export function runTokens(usage: string | null) {
  if (!usage) return 0;
  try {
    const value = JSON.parse(usage) as Record<string, unknown>;
    const number = (key: string) =>
      typeof value[key] === "number" ? (value[key] as number) : 0;
    if (typeof value.total_tokens === "number") return value.total_tokens;
    return (
      number("input_tokens") +
      number("output_tokens") +
      number("cache_creation_input_tokens") +
      number("cache_read_input_tokens")
    );
  } catch {
    return 0;
  }
}

/** Reviewer tokens in the window, per PR, pod and track. */
export function spend(
  runs: StoredRun[],
  labelsOf: (pr: number) => string[],
  hours: number,
  out: (text: string) => void,
) {
  const groups = {
    pr: new Map<string, number>(),
    pod: new Map<string, number>(),
    track: new Map<string, number>(),
  };
  const add = (map: Map<string, number>, key: string, tokens: number) =>
    map.set(key, (map.get(key) ?? 0) + tokens);
  let total = 0;
  for (const entry of runs) {
    const tokens = runTokens(entry.usage);
    total += tokens;
    const labels = labelsOf(entry.pr);
    const named = (prefix: string) =>
      labels
        .filter((label) => label.startsWith(prefix))
        .map((label) => label.slice(prefix.length));
    add(groups.pr, `#${entry.pr}`, tokens);
    for (const pod of named("pod:").length ? named("pod:") : ["(no pod)"])
      add(groups.pod, pod, tokens);
    for (const track of named("track:").length
      ? named("track:")
      : ["(no track)"])
      add(groups.track, track, tokens);
  }
  const format = (value: number) => value.toLocaleString("en-US");
  out(
    `reviewer tokens, last ${hours} h: ${format(total)} in ${runs.length} run(s)`,
  );
  if (!runs.length) return;
  for (const [name, map] of Object.entries(groups))
    out(
      `  by ${name}: ${[...map]
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => `${key} ${format(value)}`)
        .join("; ")}`,
    );
}
