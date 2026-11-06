import type { Database } from "bun:sqlite";
import { getMeta, latestRun, type StoredAction, type StoredRun } from "./store";

/** A narrow operator grant, never an automatic timeout retry policy. */
export function authorizedTimeoutRetry(
  crew: Database,
  action: StoredAction,
  last: StoredRun | null,
) {
  if (
    !last ||
    last.exitCode !== -124 ||
    last.result !== null ||
    action.state !== "pending" ||
    action.attempts !== 1 ||
    latestRun(crew, action.key)?.id !== last.id
  )
    return null;
  const raw = getMeta(crew, `operator-retry:${last.id}`);
  if (!raw) return null;
  try {
    const grant = JSON.parse(raw);
    return grant.authorizedBy === "steward-main" &&
      Number.isFinite(grant.authorizedAt) &&
      grant.priorRun === last.id &&
      grant.actionKey === action.key &&
      grant.pr === action.pr &&
      grant.pr === last.pr &&
      grant.head === action.head &&
      grant.head === last.head &&
      grant.reviewer === action.target &&
      grant.reviewer === last.reviewer &&
      grant.round === last.round &&
      grant.maxRetries === 1 &&
      grant.retryRun === null &&
      action.kind === "confirm"
      ? grant
      : null;
  } catch {
    return null;
  }
}
