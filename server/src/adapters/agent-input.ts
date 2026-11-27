import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { harnessName, foregroundHarness } from "../herdr-core/harness";
import type { TuiControlClient } from "./herdr-runtime";

type Row = Record<string, unknown>;
const expectedAgent = new AsyncLocalStorage<Row>();

/** Keep the caller's checked session across the final transport preparation. */
export function withAgentInput<T>(info: Row | null, send: () => T): T {
  return info ? expectedAgent.run(info, send) : send();
}
const row = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;

/** Only live process evidence can authorize typing; OSC/session reports may linger. */
export async function agentForegroundWitness(
  call: TuiControlClient["call"],
  paneId: string,
  agent: unknown,
): Promise<string | null> {
  const harness = harnessName(agent);
  if (!harness) return null;
  const reply = row(await call("pane.process_info", { pane_id: paneId }));
  const process = row(reply?.process_info);
  const group = process?.foreground_process_group_id;
  if (
    !process ||
    (process.pane_id !== undefined && process.pane_id !== paneId) ||
    !Number.isSafeInteger(group) ||
    Number(group) <= 1 ||
    group === process.shell_pid ||
    !Array.isArray(process.foreground_processes)
  )
    return null;
  const leader = row(
    process.foreground_processes.find(
      (item: unknown) => row(item)?.pid === group,
    ),
  );
  if (!leader || foregroundHarness(leader.name, leader.argv) !== harness)
    return null;
  const agents = process.foreground_processes.flatMap((item: unknown) => {
    const seen = row(item);
    return seen &&
      Number.isSafeInteger(seen.pid) &&
      Number(seen.pid) > 1 &&
      foregroundHarness(seen.name, seen.argv) === harness
      ? [[seen.pid, harness]]
      : [];
  });
  if (!agents.length) return null;
  return createHash("sha256")
    .update(JSON.stringify([paneId, harness, group, agents.sort()]))
    .digest("hex");
}

const identity = (agent: Row) =>
  JSON.stringify([
    agent.pane_id,
    agent.terminal_id,
    agent.agent,
    agent.agent_session,
    agent.terminal_title,
    agent.state_change_seq,
    agent.revision,
  ]);

/** A shared last boundary for prompts, notification replies and Chat input. */
export async function guardAgentInput(
  client: TuiControlClient,
  params: Row,
  paneInput: boolean,
): Promise<string> {
  const refuse = () =>
    new Error(
      "agent_not_ready: Original agent is not attached to this terminal's foreground. Nothing was sent.",
    );
  try {
    const target = paneInput ? params.pane_id : params.target;
    if (typeof target !== "string" || !target) throw refuse();
    const before = row(row(await client.call("agent.get", { target }))?.agent);
    const expected = expectedAgent.getStore();
    if (
      !before ||
      typeof before.pane_id !== "string" ||
      !before.terminal_id ||
      (paneInput && before.pane_id !== target) ||
      (expected && identity(expected) !== identity(before))
    )
      throw refuse();
    const witness = await agentForegroundWitness(
      client.call.bind(client),
      before.pane_id,
      before.agent,
    );
    if (
      !witness ||
      (params.world_foreground !== undefined &&
        params.world_foreground !== witness)
    )
      throw refuse();
    const after = row(
      row(await client.call("agent.get", { target: before.pane_id }))?.agent,
    );
    if (!after || identity(before) !== identity(after)) throw refuse();
    return before.pane_id;
  } catch {
    throw refuse();
  }
}
