import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
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
  gateStoreBytes = 0,
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
  out(`gate store: ${formatBytes(gateStoreBytes)}`);
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

const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : bytes < 1024 ** 3
        ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
        : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

function storeSize(path: string) {
  return [path, `${path}-wal`, `${path}-shm`].reduce(
    (total, file) => total + (existsSync(file) ? statSync(file).size : 0),
    0,
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
  const gatePath = join(dir, "gate.sqlite");
  const gate = openStore(gatePath);
  try {
    const seen = currentInputs(gate);
    const configPath = join(dir, "config.json");
    const settings = existsSync(configPath) ? loadSettings(configPath) : null;
    status(crew, out, now, seen && settings, seen ?? [], storeSize(gatePath));
  } finally {
    gate.close();
  }
}
