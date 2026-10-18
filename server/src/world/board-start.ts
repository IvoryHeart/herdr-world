/**
 * Start a new agent from a Board note: create a tab in the chosen workspace,
 * start the agent in its root pane, wait (within a bound) until it is
 * interactive, then prompt it with the note once. With no text it starts the
 * agent and sends nothing. Nothing is retried; a failure reports what was
 * created so the user can inspect it.
 */

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type StartFromNoteRequest = {
  workspace_id: string;
  kind: string;
  name: string;
  text: string;
  isCurrent: () => boolean;
  /** Test hooks: the clock and a pause between readiness checks. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export type Created = { tab_id: string; pane_id: string; terminal_id: string };
export type StartFromNoteOutcome =
  | ({ status: "sent" | "started" } & Created)
  | ({ status: "uncertain" | "failed"; message: string } & Partial<Created>);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const KINDS = /^[a-z][a-z0-9_-]{0,31}$/;

export async function startFromNote(
  call: HerdrCall,
  request: StartFromNoteRequest,
): Promise<StartFromNoteOutcome> {
  const now = request.now ?? Date.now;
  const sleep =
    request.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const text = request.text.trim();
  if (!KINDS.test(request.kind))
    return { status: "failed", message: "Unknown agent kind." };
  if (!request.isCurrent())
    return { status: "failed", message: "The host reconnected. Try again." };

  const tabResult = await call("tab.create", {
    workspace_id: request.workspace_id,
    label: request.name,
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
  const created: Created = {
    tab_id: String(tab.tab_id),
    pane_id: pane.pane_id,
    terminal_id: pane.terminal_id,
  };
  const stale = (): StartFromNoteOutcome => ({
    status: "uncertain",
    message:
      "The host reconnected while the agent was starting; the note was not sent.",
    ...created,
  });

  if (!request.isCurrent()) return stale();
  try {
    await call("agent.start", {
      pane_id: created.pane_id,
      kind: request.kind,
      name: request.name,
      timeout_ms: request.timeoutMs ?? 60_000,
    });
  } catch (error) {
    // A lost reply may still have started the agent: inspect, never relaunch.
    if (!text)
      return {
        status: "uncertain",
        message: `The agent may not have started: ${error instanceof Error ? error.message : String(error)}`,
        ...created,
      };
  }
  // Nothing to send: the agent is started and becomes ready on its own.
  if (!text) return { status: "started", ...created };

  const deadline = now() + (request.timeoutMs ?? 60_000);
  while (now() < deadline) {
    if (!request.isCurrent()) return stale();
    const live = await call("pane.get", { pane_id: created.pane_id }).catch(
      () => null,
    );
    const livePane =
      isRecord(live) && isRecord(live.pane) ? live.pane : undefined;
    if (!livePane || livePane.terminal_id !== created.terminal_id)
      return {
        status: "failed",
        message:
          "The new tab changed before the agent was ready; the note was not sent.",
        ...created,
      };
    let agent: Record<string, unknown> | undefined;
    try {
      const result = await call("agent.get", { target: created.pane_id });
      agent =
        isRecord(result) && isRecord(result.agent) ? result.agent : undefined;
    } catch (error) {
      // Detection can lag the launch; only a missing agent is worth waiting on.
      if (!(error instanceof Error) || !/^agent_not_found:/.test(error.message))
        return {
          status: "failed",
          message: `The agent could not be checked; the note was not sent.`,
          ...created,
        };
    }
    if (agent) {
      if (agent.agent_status === "blocked")
        return {
          status: "uncertain",
          message:
            "The agent is waiting on a question before it is ready; the note was not sent.",
          ...created,
        };
      if (agent.interactive_ready === true) {
        if (!request.isCurrent()) return stale();
        try {
          const sent = await call("agent.prompt", {
            target: created.pane_id,
            text,
          });
          if (
            isRecord(sent) &&
            isRecord(sent.agent) &&
            sent.agent.pane_id === created.pane_id
          )
            return { status: "sent", ...created };
          return {
            status: "uncertain",
            message: "Herdr did not confirm the prompt; check the agent.",
            ...created,
          };
        } catch (error) {
          return {
            status: "uncertain",
            message: `The prompt may not have been sent: ${error instanceof Error ? error.message : String(error)}`,
            ...created,
          };
        }
      }
    }
    await sleep(500);
  }
  return {
    status: "uncertain",
    message: "The agent may still be starting; the note was not sent.",
    ...created,
  };
}
