/**
 * Send a Board note to the agent in one exact pane. Only ever on the user's
 * Send. Before anything is sent the pane must still hold the terminal the
 * string witnessed and a detected agent, and the runtime must be the one the
 * request was made against. The prompt is sent once and never retried.
 */

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type SendNoteRequest = {
  pane_id: string;
  /** A terminal the string witnessed; it changes when Herdr restarts. */
  terminal_id: string;
  text: string;
  isCurrent: () => boolean;
};

export type SendNoteOutcome =
  | { status: "sent"; agent: string }
  | {
      status: "refused";
      reason: "stale" | "changed" | "no_agent" | "blocked" | "empty";
      message: string;
    }
  | { status: "failed"; message: string };

const MAX_TEXT = 4_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const refuse = (
  reason: Extract<SendNoteOutcome, { status: "refused" }>["reason"],
  message: string,
): SendNoteOutcome => ({ status: "refused", reason, message });

export async function sendNote(
  call: HerdrCall,
  request: SendNoteRequest,
): Promise<SendNoteOutcome> {
  const text = request.text.trim();
  if (!text) return refuse("empty", "The note is empty.");
  if (text.length > MAX_TEXT)
    return refuse("empty", "The note is too long to send.");
  if (!request.isCurrent())
    return refuse(
      "stale",
      "The host reconnected. Check the string, then send again.",
    );
  let pane: Record<string, unknown> | undefined;
  try {
    const result = await call("pane.get", { pane_id: request.pane_id });
    pane = isRecord(result) && isRecord(result.pane) ? result.pane : undefined;
  } catch {
    pane = undefined;
  }
  if (
    !pane ||
    pane.pane_id !== request.pane_id ||
    pane.terminal_id !== request.terminal_id
  )
    return refuse(
      "changed",
      "That pane is no longer the one this note is strung to.",
    );
  if (!pane.agent)
    return refuse("no_agent", "No agent is running in that pane.");
  const agentResult = await call("agent.get", { target: request.pane_id });
  const agent =
    isRecord(agentResult) && isRecord(agentResult.agent)
      ? agentResult.agent
      : undefined;
  if (
    !agent ||
    agent.pane_id !== request.pane_id ||
    agent.terminal_id !== request.terminal_id
  )
    return refuse(
      "changed",
      "That pane is no longer the one this note is strung to.",
    );
  if (!request.isCurrent())
    return refuse(
      "stale",
      "The host reconnected. Check the string, then send again.",
    );
  try {
    const result = await call("agent.prompt", {
      target: request.pane_id,
      text,
    });
    const sent =
      isRecord(result) && isRecord(result.agent) ? result.agent : undefined;
    if (!sent || sent.pane_id !== request.pane_id)
      return {
        status: "failed",
        message:
          "Herdr did not confirm the prompt; check the agent before sending again.",
      };
    return { status: "sent", agent: String(agent.agent ?? "agent") };
  } catch (error) {
    // Herdr rejects a blocked agent before submitting any input.
    if (error instanceof Error && /^agent_blocked:/.test(error.message))
      return refuse(
        "blocked",
        "The agent is waiting on a question; answer it first. Nothing was sent.",
      );
    return {
      status: "failed",
      message: `The prompt may not have been sent: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
