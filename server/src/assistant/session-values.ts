import {
  isAssistantSnapshot,
  type AssistantMessage,
  type AssistantSnapshot,
} from "../../../shared/assistant";
import { refs, MAX_CONTEXT_BYTES, savedQueue } from "./assistant-state";
const jsonBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
export function authUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function savedWorkspaces(value: unknown) {
  if (value === undefined) return [];
  try {
    return refs(value);
  } catch {
    return [];
  }
}

export function savedSession(
  saved: Record<string, unknown>,
  state: AssistantSnapshot,
) {
  if (
    !Array.isArray(saved.messages) ||
    !Array.isArray(saved.entries) ||
    !Array.isArray(saved.requests) ||
    !isAssistantSnapshot({ ...state, messages: saved.messages }) ||
    !saved.requests.every(
      (id: unknown) => typeof id === "string" && id.length <= 500,
    )
  )
    throw new Error("Invalid saved session");
  return {
    messages: saved.messages as AssistantMessage[],
    entries: jsonBytes(saved.entries) <= MAX_CONTEXT_BYTES ? saved.entries : [],
    entry_scope: typeof saved.entry_scope === "string" ? saved.entry_scope : "",
    created_workspaces: savedWorkspaces(saved.created_workspaces),
    requests: (saved.requests as string[]).slice(-1000),
    queue: savedQueue(saved.queue),
  };
}

export function retirePreviews(
  messages: AssistantMessage[],
  detail: string,
  cancelProposal: (id: string) => void,
) {
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (action.status === "pending") {
        action.status = "cancelled";
        action.detail = detail;
      } else if (action.status === "executing") {
        action.status = "uncertain";
        action.detail =
          "The bridge restarted during execution. Check the target before proposing another operation; this action will not be replayed.";
      }
    }
    for (const proposal of message.task_proposals ?? [])
      if (proposal.status === "pending") {
        proposal.status = "cancelled";
        cancelProposal(proposal.id);
      }
  }
}
