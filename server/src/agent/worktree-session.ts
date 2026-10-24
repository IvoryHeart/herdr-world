import { isRecord, stringValue } from "./session-utils";

/** Native cwd/branch fields in this bound transcript, never guesses from prose. */
export function sessionWorktreeMetadata(
  agent: string,
  records: readonly Record<string, unknown>[],
) {
  let cwd: string | undefined;
  let branch: string | undefined;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]!;
    const metadata =
      agent === "codex"
        ? (record.type === "session_meta" || record.type === "turn_context") &&
          isRecord(record.payload)
          ? record.payload
          : null
        : record;
    if (!metadata) continue;
    const path = stringValue(metadata.cwd);
    if (!cwd && path.startsWith("/") && !path.includes("\0")) cwd = path;
    const git = isRecord(metadata.git) ? metadata.git : null;
    const reportedBranch =
      stringValue(metadata.gitBranch) || stringValue(git?.branch);
    if (!branch && reportedBranch) branch = reportedBranch;
    if (cwd && branch) break;
  }
  return cwd || branch
    ? {
        ...(cwd ? { cwd } : {}),
        ...(branch ? { branch } : {}),
        sourceRef:
          agent === "codex" ? "Codex rollout cwd" : "Bound transcript cwd",
      }
    : null;
}
