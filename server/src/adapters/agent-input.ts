import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  harnessName,
  foregroundHarness,
  unsafeForegroundProgram,
  mayWrapHarness,
} from "../herdr-core/harness";
import type { TuiControlClient } from "./herdr-runtime";

type Row = Record<string, unknown>;
const expectedAgent = new AsyncLocalStorage<{ info: Row | null }>();

/** Keep the caller's checked session across the final transport preparation. */
export function withAgentInput<T>(info: Row | null, send: () => T): T {
  return expectedAgent.run({ info }, send);
}

/** Server-side opt-in; explicit browser terminal input retains terminal authority. */
export function isAgentInput(): boolean {
  return expectedAgent.getStore() !== undefined;
}
const row = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;

/** Admission errors prove no text was submitted; keep native codes out of UI. */
export function agentInputFailure(error: unknown): {
  reason: "changed" | "unavailable";
  message: string;
} | null {
  if (!(error instanceof Error)) return null;
  const match = /^(agent_not_ready|agent_input_unavailable):\s*(.*)$/s.exec(
    error.message,
  );
  return match
    ? {
        reason: match[1] === "agent_not_ready" ? "changed" : "unavailable",
        message: `Not sent. ${match[2]}`,
      }
    : null;
}

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
  if (!process) throw new Error("Foreground information could not be read");
  const group = process?.foreground_process_group_id;
  if (
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
  if (!leader || foregroundHarness(leader.name, leader.argv) !== harness) {
    if (
      leader &&
      mayWrapHarness(leader, process.shell_pid) &&
      process.foreground_processes.some((item: unknown) => {
        const child = row(item);
        return (
          child?.pid !== group &&
          foregroundHarness(child?.name, child?.argv) === harness
        );
      })
    )
      throw new Error(
        "agent_not_ready: Original agent is not attached; started through a wrapper script; use `exec` in the script. Nothing was sent.",
      );
    return null;
  }
  const agents = process.foreground_processes.map((item: unknown) => {
    const seen = row(item);
    return seen &&
      Number.isSafeInteger(seen.pid) &&
      Number(seen.pid) > 1 &&
      typeof seen.name === "string" &&
      seen.name.length > 0 &&
      (seen.pid === group || !unsafeForegroundProgram(seen.name, seen.argv))
      ? [seen.pid, seen.name]
      : null;
  });
  if (!agents.length || agents.some((item) => item === null)) return null;
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
    const readAgent = async (target: string) => {
      const reply = row(await client.call("agent.get", { target }));
      if (!reply || !("agent" in reply))
        throw new Error("Agent information could not be read");
      return row(reply.agent);
    };
    const target = paneInput ? params.pane_id : params.target;
    if (typeof target !== "string" || !target) throw refuse();
    const before = await readAgent(target);
    const expected = expectedAgent.getStore()?.info;
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
    const after = await readAgent(before.pane_id);
    if (!after || identity(before) !== identity(after)) throw refuse();
    return before.pane_id;
  } catch (error) {
    if (error instanceof Error && /^agent_not_ready:/.test(error.message))
      throw error;
    if (
      error instanceof Error &&
      /^(agent_not_found|pane_not_found):/.test(error.message)
    )
      throw refuse();
    throw new Error(
      "agent_input_unavailable: The terminal could not be checked. Nothing was sent; waiting to retry.",
      { cause: error },
    );
  }
}
