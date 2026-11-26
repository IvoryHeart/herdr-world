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

type ResidentSession = Pick<
  ApartmentResident,
  "harness" | "session_id" | "cwd"
>;
type ResolvedResident = Awaited<ReturnType<typeof resolveAgentSessionInfo>>;

/**
 * A finished agent's transcript on its host, found from its recorded session
 * ID with the resolver Chat uses (the terminal no longer exists, so nothing
 * is asked of Herdr), or why it cannot be found.
 */
export async function resolveResidentSession(
  resident: ResidentSession,
  files: AgentSessionFileAccess,
): Promise<
  | {
      ok: true;
      resolved: ResolvedResident & {
        file: NonNullable<ResolvedResident["file"]>;
      };
    }
  | { ok: false; detail: string }
> {
  const harness = resident.harness ?? "";
  if (!resident.session_id)
    return {
      ok: false,
      detail:
        "World did not see this agent's session, so its history cannot be found.",
    };
  let resolved: ResolvedResident;
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
    return {
      ok: false,
      detail: `World cannot read ${harness || "this harness"}'s history: ${(error as Error).message}`,
    };
  }
  if (resolved.status !== "ok" || !resolved.file)
    return {
      ok: false,
      detail:
        resolved.detail || "The agent's transcript is no longer on its host.",
    };
  return { ok: true, resolved: { ...resolved, file: resolved.file } };
}

/**
 * A finished agent's conversation, read from its harness's own transcript
 * on its host with the same resolver and projection Chat uses.
 */
export async function readApartmentHistory(
  resident: ResidentSession,
  files: AgentSessionFileAccess,
): Promise<ApartmentHistory> {
  const found = await resolveResidentSession(resident, files);
  if (!found.ok) return unavailable(found.detail);
  const { resolved } = found;
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
