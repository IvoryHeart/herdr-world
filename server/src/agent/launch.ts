import { AGENT_KIND, agentNameFor } from "../../../shared/agentProfile";

/**
 * Start an agent in a new tab: create the tab in the chosen workspace, start
 * the agent in its root pane once the shell can take it, wait (within a
 * bound) until it is interactive, then send the first prompt once. Board,
 * Town, Spaces and profiles all launch through here.
 *
 * Herdr refuses `agent.start` until the new shell reaches its prompt
 * (`agent_pane_busy`) and refuses names outside its pattern or already in use.
 * Those refusals start nothing, so they are retried within the bound; any other
 * failure is inspected, never relaunched.
 */

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type LaunchRequest = {
  workspace_id: string;
  kind: string;
  /** The tab's label; the agent's Herdr name is derived from it. */
  label: string;
  /**
   * Native arguments for the agent's executable (see launchPlan), or a
   * function of the Herdr name the agent gets.
   */
  args?: string[] | ((agentName: string) => string[]);
  /** The first prompt; empty sends nothing. */
  text: string;
  isCurrent: () => boolean;
  /** Test hooks: the clock and a pause between checks. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export type Created = {
  tab_id: string;
  pane_id: string;
  terminal_id: string;
  agent_name?: string;
};
export type LaunchOutcome =
  | ({ status: "sent" | "started" } & Created)
  | ({ status: "uncertain" | "failed"; message: string } & Partial<Created>);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/** A Herdr refusal reads `code: message`; transport errors do not. */
const refusal = (error: unknown) => {
  const code = /^([a-z][a-z0-9_]*): /.exec(message(error))?.[1];
  return code && code !== "timeout" && code !== "error" ? code : null;
};
const SHELL_WAIT_MS = 15_000;
const EXIT_GRACE_MS = 3_000;

export async function launchAgent(
  call: HerdrCall,
  request: LaunchRequest,
): Promise<LaunchOutcome> {
  const now = request.now ?? Date.now;
  const sleep =
    request.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = request.timeoutMs ?? 60_000;
  const text = request.text.trim();
  if (!AGENT_KIND.test(request.kind))
    return { status: "failed", message: "Unknown agent kind." };
  if (!request.isCurrent())
    return { status: "failed", message: "The host reconnected. Try again." };

  // Live names on this host, so the new agent's name is free.
  const taken = new Set<string>();
  try {
    const listed = await call("agent.list", {});
    for (const agent of isRecord(listed) && Array.isArray(listed.agents)
      ? listed.agents
      : [])
      if (isRecord(agent) && typeof agent.name === "string")
        taken.add(agent.name);
  } catch {
    // A taken name is refused and retried below.
  }

  const tabResult = await call("tab.create", {
    workspace_id: request.workspace_id,
    label: request.label,
  });
  const pane =
    isRecord(tabResult) && isRecord(tabResult.root_pane)
      ? tabResult.root_pane
      : undefined;
  const tab =
    isRecord(tabResult) && isRecord(tabResult.tab) ? tabResult.tab : undefined;
  if (
    !pane ||
    !tab ||
    typeof pane.pane_id !== "string" ||
    typeof pane.terminal_id !== "string"
  )
    return { status: "failed", message: "Herdr did not confirm the new tab." };
  let name = agentNameFor(request.label, taken);
  const created = (): Created => ({
    tab_id: String(tab.tab_id),
    pane_id: pane.pane_id as string,
    terminal_id: pane.terminal_id as string,
    agent_name: name,
  });
  const stale = (): LaunchOutcome => ({
    status: "uncertain",
    message:
      "The host reconnected while the agent was starting; nothing was sent.",
    ...created(),
  });

  const shellDeadline = now() + SHELL_WAIT_MS;
  for (;;) {
    if (!request.isCurrent()) return stale();
    const args =
      typeof request.args === "function" ? request.args(name) : request.args;
    try {
      await call("agent.start", {
        pane_id: created().pane_id,
        kind: request.kind,
        name,
        timeout_ms: timeoutMs,
        ...(args?.length ? { args } : {}),
      });
      break;
    } catch (error) {
      const code = refusal(error);
      if (code === "agent_name_taken") {
        taken.add(name);
        name = agentNameFor(request.label, taken);
        continue;
      }
      if (code === "agent_pane_busy" && now() < shellDeadline) {
        await sleep(250);
        continue;
      }
      if (code)
        return {
          status: "failed",
          message:
            code === "agent_pane_busy"
              ? "The new tab's shell did not become ready, so the agent was not started."
              : `Herdr did not start the agent: ${message(error)}`,
          ...created(),
        };
      // A lost reply may still have started the agent: inspect, never relaunch.
      break;
    }
  }

  const started = now();
  const deadline = started + timeoutMs;
  let shellSeen = 0;
  const shellIsBack = async () => {
    const info = await call("pane.process_info", {
      pane_id: created().pane_id,
    }).catch(() => null);
    const process =
      isRecord(info) && isRecord(info.process_info) ? info.process_info : null;
    return (
      process !== null &&
      typeof process.shell_pid === "number" &&
      process.foreground_process_group_id === process.shell_pid
    );
  };
  while (now() < deadline) {
    if (!request.isCurrent()) return stale();
    const live = await call("pane.get", { pane_id: created().pane_id }).catch(
      () => null,
    );
    const livePane =
      isRecord(live) && isRecord(live.pane) ? live.pane : undefined;
    if (!livePane || livePane.terminal_id !== created().terminal_id)
      return {
        status: "failed",
        message:
          "The new tab changed before the agent was ready; nothing was sent.",
        ...created(),
      };
    let agent: Record<string, unknown> | undefined;
    try {
      const result = await call("agent.get", { target: created().pane_id });
      agent =
        isRecord(result) && isRecord(result.agent) ? result.agent : undefined;
    } catch (error) {
      // Detection can lag the launch; only a missing agent is worth waiting on.
      if (!/^agent_not_found:/.test(message(error)))
        return {
          status: "failed",
          message: "The agent could not be checked; nothing was sent.",
          ...created(),
        };
    }
    if (agent) {
      // The ready agent must be the one just launched here: after a lost
      // start reply another agent may hold this pane.
      if (
        agent.pane_id !== created().pane_id ||
        (agent.terminal_id != null &&
          agent.terminal_id !== created().terminal_id) ||
        (agent.agent != null && agent.agent !== request.kind) ||
        agent.name !== name
      )
        return {
          status: "failed",
          message:
            "A different agent answered in the new tab; nothing was sent.",
          ...created(),
        };
      if (agent.agent_status === "blocked")
        return {
          status: "uncertain",
          message:
            "The agent is waiting on a question before it is ready; open it to answer. Nothing was sent.",
          ...created(),
        };
      if (agent.agent === request.kind && agent.interactive_ready === true) {
        if (!text) return { status: "started", ...created() };
        if (!request.isCurrent()) return stale();
        try {
          const sent = await call("agent.prompt", {
            target: created().pane_id,
            text,
          });
          if (
            isRecord(sent) &&
            isRecord(sent.agent) &&
            sent.agent.pane_id === created().pane_id
          )
            return { status: "sent", ...created() };
          return {
            status: "uncertain",
            message: "Herdr did not confirm the prompt; check the agent.",
            ...created(),
          };
        } catch (error) {
          return {
            status: "uncertain",
            message: `The prompt may not have been sent: ${message(error)}`,
            ...created(),
          };
        }
      }
    }
    // Not ready yet. A harness that refuses its options exits at once and
    // leaves the shell in the foreground, while Herdr may still list the
    // launch as pending; seen twice after a grace period, it has ended
    // rather than not yet begun.
    if (now() - started >= EXIT_GRACE_MS && (await shellIsBack()))
      shellSeen += 1;
    else shellSeen = 0;
    if (shellSeen >= 2)
      return {
        status: "failed",
        message:
          "The agent exited as it started; open its tab to see why. Nothing was sent.",
        ...created(),
      };
    await sleep(500);
  }
  return {
    status: "uncertain",
    message: "The agent may still be starting; nothing was sent.",
    ...created(),
  };
}

/**
 * The agent kinds a host's Herdr supports, from its agent manifests. Herdr
 * before manifests were exposed reports none; then the two long-supported
 * kinds are offered and Herdr still validates the choice.
 */
export async function agentKinds(call: HerdrCall): Promise<string[]> {
  try {
    const result = await call("server.agent_manifests", {});
    const kinds = (
      isRecord(result) && Array.isArray(result.manifests)
        ? result.manifests
        : []
    )
      .map((m) => (isRecord(m) ? m.agent : undefined))
      .filter(
        (kind): kind is string =>
          typeof kind === "string" && AGENT_KIND.test(kind),
      );
    if (kinds.length) return [...new Set(kinds)];
  } catch {
    // Older Herdr: fall through.
  }
  return ["claude", "codex"];
}
