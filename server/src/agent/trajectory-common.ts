import { basename } from "node:path";
import type { AtifStep, AtifTrajectory, SessionFile } from "./session-types";
import { isRecord, stringValue, textFromContent } from "./session-utils";
import { summarizeTokenUsage, tokenUsageToMetrics } from "./token-usage";

export function modelNameFromRecord(record: Record<string, unknown>) {
  return (
    stringValue(record.model) ||
    stringValue(record.model_name) ||
    (isRecord(record.message) ? stringValue(record.message.model) : "")
  );
}

export function agentVersionFromRecords(
  agent: string,
  records: Record<string, unknown>[],
) {
  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : null;
    const version =
      stringValue(record.cli_version) ||
      ((agent === "pi" || agent === "omp") && record.type === "session"
        ? ""
        : stringValue(record.version)) ||
      stringValue(record.originator) ||
      (payload
        ? stringValue(payload.cli_version) ||
          stringValue(payload.version) ||
          stringValue(payload.originator)
        : "");
    if (version) return version;
  }
  if (agent === "kimi") return "kimi-code";
  if (agent === "agy") return "antigravity-cli";
  return "unknown";
}

export function sessionIdFromRecords(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  if (file.sessionId) return file.sessionId;
  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : null;
    const id =
      stringValue(record.session_id) ||
      stringValue(record.sessionId) ||
      stringValue(record.conversation_id) ||
      (record.type === "session" ? stringValue(record.id) : "") ||
      (payload
        ? stringValue(payload.session_id) ||
          stringValue(payload.sessionId) ||
          stringValue(payload.id)
        : "");
    if (id) return id;
  }
  return basename(file.path).replace(/\.[^.]+$/, "");
}

export function createTrajectory(
  agent: string,
  file: SessionFile,
  records: Record<string, unknown>[],
  steps: Omit<AtifStep, "step_id">[],
  options: { promptIncludesCached?: boolean } = {},
): AtifTrajectory {
  const tokenUsage = summarizeTokenUsage(records);
  const metrics = tokenUsageToMetrics(tokenUsage);
  if (
    options.promptIncludesCached &&
    metrics?.prompt_tokens !== undefined &&
    metrics.cached_tokens !== undefined
  ) {
    metrics.prompt_tokens += metrics.cached_tokens;
  }
  const sessionId = sessionIdFromRecords(file, records);
  const normalizedSteps = steps
    .filter(
      (step) =>
        step.message.trim() ||
        step.reasoning_content?.trim() ||
        step.tool_calls?.length ||
        step.observation?.results.length,
    )
    .map((step, index) => ({ ...step, step_id: index + 1 }));
  return {
    schema_version: "ATIF-v1.7",
    session_id: sessionId,
    trajectory_id:
      file.sessionId ||
      (agent === "pi" || agent === "omp"
        ? sessionId
        : basename(file.path).replace(/\.[^.]+$/, "")),
    agent: {
      name:
        agent === "muse"
          ? "muse-code"
          : agent === "kimi"
            ? "kimi-code"
            : agent === "claude"
              ? "claude-code"
              : agent === "grok"
                ? "grok-build"
                : agent === "agy"
                  ? "antigravity-cli"
                  : agent,
      version: file.agentVersion || agentVersionFromRecords(agent, records),
      model_name: file.modelName || undefined,
    },
    steps: normalizedSteps,
    final_metrics: {
      total_prompt_tokens: metrics?.prompt_tokens,
      total_completion_tokens: metrics?.completion_tokens,
      total_cached_tokens: metrics?.cached_tokens,
      total_steps: normalizedSteps.length,
      extra: metrics?.extra,
    },
    extra: {
      source_path: file.path,
      source_records: records.length,
      projection: "herdr-world-lightweight",
    },
  };
}

export function toolOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  const text = textFromContent(value);
  return text || (value == null ? "" : JSON.stringify(value, null, 2));
}

export function toolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : { value };
  } catch {
    return { value };
  }
}
