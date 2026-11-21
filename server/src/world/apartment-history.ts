import {
  APARTMENT_HISTORY_MESSAGES,
  type ApartmentHistory,
  type ApartmentResident,
} from "../../../shared/apartments";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import { readSessionProjection } from "../agent/session-projection-cache";
import {
  createAgentSessionResolverContext,
  resolveAgentSessionInfo,
} from "../agent/session-resolver";
import { latestTurnReceipt } from "../agent/turn-receipt";

const MESSAGE_CHARS = 8000;
const context = createAgentSessionResolverContext();

const unavailable = (detail: string): ApartmentHistory => ({
  status: "unavailable",
  detail,
  messages: [],
  truncated: false,
  report: null,
});

/**
 * A finished agent's conversation, read from its harness's own transcript
 * on its host with the same resolver and projection Chat uses. Only the
 * recorded session ID names the transcript; the terminal no longer exists,
 * so nothing is asked of Herdr.
 */
export async function readApartmentHistory(
  resident: Pick<ApartmentResident, "harness" | "session_id" | "cwd">,
  files: AgentSessionFileAccess,
): Promise<ApartmentHistory> {
  const harness = resident.harness ?? "";
  if (!resident.session_id)
    return unavailable(
      "World did not see this agent's session, so its history cannot be found.",
    );
  let resolved: Awaited<ReturnType<typeof resolveAgentSessionInfo>>;
  try {
    resolved = await resolveAgentSessionInfo(
      { pane_id: "apartment", agent: harness },
      {
        agent: harness,
        agent_session: {
          source: "apartment",
          agent: harness,
          kind: "id",
          value: resident.session_id,
        },
        ...(resident.cwd ? { cwd: resident.cwd } : {}),
      },
      files,
      context,
    );
  } catch (error) {
    return unavailable(
      `World cannot read ${harness || "this harness"}'s history: ${(error as Error).message}`,
    );
  }
  if (resolved.status !== "ok" || !resolved.file)
    return unavailable(
      resolved.detail || "The agent's transcript is no longer on its host.",
    );
  try {
    const projection = await readSessionProjection(
      resolved.agent,
      resolved.file,
      files,
    );
    const all = projection.messages;
    const kept = all.slice(-APARTMENT_HISTORY_MESSAGES);
    return {
      status: "ok",
      detail: "",
      messages: kept.map((message) => ({
        id: message.id,
        role: message.role,
        text:
          message.text.length > MESSAGE_CHARS
            ? `${message.text.slice(0, MESSAGE_CHARS - 1)}…`
            : message.text,
        sent_at: message.sent_at,
      })),
      truncated: kept.length < all.length,
      report:
        latestTurnReceipt(resolved.file, projection.trajectory)?.report ?? null,
    };
  } catch (error) {
    return unavailable(
      `The agent's transcript could not be read: ${(error as Error).message}`,
    );
  }
}
