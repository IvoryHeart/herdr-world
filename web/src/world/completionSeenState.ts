import type { OfficeAgent } from "./herdrOfficeProjection";

export const COMPLETION_SEEN_STORAGE_KEY = "worldCompletionSeen:v1";
const MAX_STORED_COMPLETIONS = 4_096;

type CompletionStorage = Pick<Storage, "getItem" | "setItem">;

export function officeCompletionIdentity(
  agent: Pick<
    OfficeAgent,
    "hostKey" | "observedGeneration" | "key" | "currentTerminalRef"
  >,
) {
  return JSON.stringify([
    agent.hostKey,
    agent.observedGeneration,
    agent.currentTerminalRef.nativeId,
    agent.key,
  ]);
}

export function readCompletionSeen(
  storage: CompletionStorage,
): ReadonlySet<string> {
  try {
    const raw = storage.getItem(COMPLETION_SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === "string" &&
          entry.length > 0 &&
          entry.length <= 2_048,
      ),
    );
  } catch {
    return new Set();
  }
}

export function writeCompletionSeen(
  storage: CompletionStorage,
  identities: ReadonlySet<string>,
) {
  try {
    storage.setItem(
      COMPLETION_SEEN_STORAGE_KEY,
      JSON.stringify([...identities].slice(-MAX_STORED_COMPLETIONS)),
    );
  } catch {
    // Completion acknowledgement is useful presentation state, not runtime state.
  }
}
