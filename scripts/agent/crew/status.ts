import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { shortSha } from "../../../shared/pullRequests";
import type { GateInput } from "../gate/predicate";
import { currentInputs, openStore } from "../gate/store";
import { type CrewSettings, inScope, isOnHold, loadSettings } from "./plan";
import { actionsIn, recentActions, recentRuns } from "./store";

/** `agent:crew status`: held PRs, open and recent actions, recent runs. */
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
) {
  const gate = openStore(join(dir, "gate.sqlite"));
  try {
    const seen = currentInputs(gate);
    const configPath = join(dir, "config.json");
    const settings = existsSync(configPath) ? loadSettings(configPath) : null;
    status(crew, out, now, seen && settings, seen ?? []);
  } finally {
    gate.close();
  }
}
