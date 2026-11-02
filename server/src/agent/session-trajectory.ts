import { grokReasoningText, grokUserMessageText } from "./grok-session";
import type { AtifStep, SessionFile } from "./session-types";
import {
  cleanMessageText,
  isRecord,
  messageTime,
  stringValue,
  textFromContent,
  timestampMs,
} from "./session-utils";
import {
  createTokenUsageReader,
  tokenUsageForRecord,
  tokenUsageFrom,
  tokenUsageToMetrics,
} from "./token-usage";
import {
  createTrajectory,
  toolOutputText,
  toolArguments,
} from "./trajectory-common";
import { projectClaudeTrajectory } from "./claude-trajectory";

function codexContentText(value: unknown): string {
  if (!Array.isArray(value)) return textFromContent(value);
  return value
    .map((item) => {
      if (!isRecord(item)) return textFromContent(item);
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return textFromContent(item);
    })
    .filter(Boolean)
    .join("\n");
}

function toolResultExtra(value: Record<string, unknown>) {
  return {
    is_error:
      value.is_error === true ||
      value.isError === true ||
      value.status === "error" ||
      value.status === "failed" ||
      undefined,
  };
}

// Pi reports cache reads separately from uncached/cache-write input, while
// ATIF prompt_tokens represents the full prompt sent to the model.
function piTokenUsageToMetrics(value: unknown) {
  const metrics = tokenUsageToMetrics(tokenUsageFrom(value));
  if (
    metrics?.prompt_tokens !== undefined &&
    metrics.cached_tokens !== undefined
  ) {
    metrics.prompt_tokens += metrics.cached_tokens;
  }
  return metrics;
}

const CODEX_INJECTED_CONTEXT =
  /^(?:# AGENTS\.md instructions\b|<(?:environment_context|user_instructions|permissions instructions|turn_aborted)>)/;

const CODEX_QUESTION_REPLY =
  /^<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>\s*$/;

function isCodexInjectedContext(text: string) {
  return CODEX_INJECTED_CONTEXT.test(text);
}

function projectCodexTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  const hasResponseUserMessages = records.some(
    (record) =>
      record.type === "response_item" &&
      isRecord(record.payload) &&
      record.payload.type === "message" &&
      record.payload.role === "user",
  );
  const hasResponseAssistantMessages = records.some(
    (record) =>
      record.type === "response_item" &&
      isRecord(record.payload) &&
      record.payload.type === "message" &&
      record.payload.role === "assistant",
  );
  records.forEach((record, index) => {
    const timestamp = messageTime(record, file.mtimeMs, index);
    if (record.type === "event_msg" && isRecord(record.payload)) {
      const payload = record.payload;
      if (payload.type === "user_message") {
        if (hasResponseUserMessages) return;
        const text = cleanMessageText(stringValue(payload.message));
        if (text) steps.push({ timestamp, source: "user", message: text });
        return;
      }
      if (payload.type === "agent_message") {
        if (hasResponseAssistantMessages) return;
        const text = cleanMessageText(stringValue(payload.message));
        if (text) steps.push({ timestamp, source: "agent", message: text });
        return;
      }
      if (payload.type === "token_count" && isRecord(payload.info)) {
        const metrics = tokenUsageToMetrics(
          tokenUsageFrom(payload.info.total_token_usage),
        );
        if (metrics) {
          steps.push({
            timestamp,
            source: "system",
            message: "Token usage",
            metrics,
            extra: { record_type: "token_count" },
          });
        }
        return;
      }
    }
    if (record.type !== "response_item" || !isRecord(record.payload)) return;
    const payload = record.payload;
    const type = stringValue(payload.type);
    if (type === "message") {
      const role = stringValue(payload.role);
      const text = cleanMessageText(codexContentText(payload.content));
      if (!text) return;
      // Codex sends repository instructions and its environment as user
      // items; they are context, not something the user wrote.
      if (role === "user" && isCodexInjectedContext(text)) return;
      // An answer to the agent's question arrives wrapped in a tag.
      const answer =
        role === "user"
          ? CODEX_QUESTION_REPLY.exec(text)?.[1]?.trim()
          : undefined;
      if (answer === "") return;
      steps.push({
        timestamp,
        source:
          role === "user" ? "user" : role === "assistant" ? "agent" : "system",
        message: answer ?? text,
        metrics: tokenUsageToMetrics(tokenUsageFrom(payload.usage)),
      });
    } else if (type === "reasoning") {
      const text = cleanMessageText(codexContentText(payload.summary));
      steps.push({
        timestamp,
        source: "agent",
        message: text || "Reasoning",
        reasoning_content: text || undefined,
        extra: { record_type: type },
      });
    } else if (type.includes("output") || type.includes("result")) {
      const content = toolOutputText(payload.output ?? payload.content);
      steps.push({
        timestamp,
        source: "system",
        message: content || "Tool result",
        observation: {
          results: [
            {
              source_call_id:
                stringValue(payload.call_id) || stringValue(payload.id),
              content: content || stringValue(payload.status) || type,
              extra: toolResultExtra(payload),
            },
          ],
        },
        extra: { record_type: type },
      });
    } else if (type.includes("tool_call") || type.includes("function_call")) {
      const name =
        stringValue(payload.name) ||
        stringValue(payload.call_name) ||
        stringValue(payload.function_name) ||
        type;
      steps.push({
        timestamp,
        source: "agent",
        message: `Tool call: ${name}`,
        tool_calls: [
          {
            tool_call_id:
              stringValue(payload.call_id) ||
              stringValue(payload.id) ||
              `${index}`,
            function_name: name,
            arguments: toolArguments(payload.arguments ?? payload.input),
            extra: { record_type: type },
          },
        ],
      });
    } else if (type.includes("tool")) {
      const content = toolOutputText(payload.output ?? payload.content);
      steps.push({
        timestamp,
        source: "system",
        message: content || "Tool result",
        observation: {
          results: [
            {
              source_call_id:
                stringValue(payload.call_id) || stringValue(payload.id),
              content: content || stringValue(payload.status) || type,
              extra: toolResultExtra(payload),
            },
          ],
        },
        extra: { record_type: type },
      });
    }
  });
  return createTrajectory("codex", file, records, steps);
}

function projectKimiTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  const agentStepsByModelStep = new Map<string, Omit<AtifStep, "step_id">>();
  let createdAt = file.mtimeMs;
  records.forEach((record) => {
    if (record.type !== "metadata") return;
    const raw = Number(record.created_at);
    if (Number.isFinite(raw) && raw > 0) createdAt = raw;
  });
  records.forEach((record, index) => {
    const timestamp = new Date(
      timestampMs(record, createdAt, index),
    ).toISOString();
    const type = stringValue(record.type);
    if (type === "context.append_message" && isRecord(record.message)) {
      const role = stringValue(record.message.role);
      // Kimi's authoritative assistant output is emitted as loop events. Reading
      // assistant context messages as well would duplicate the same response.
      if (role !== "user") return;
      const text = cleanMessageText(textFromContent(record.message.content));
      if (!text) return;
      steps.push({
        timestamp,
        source: "user",
        message: text,
        extra: { record_type: type },
      });
      return;
    }
    if (type !== "context.append_loop_event" || !isRecord(record.event)) return;
    const event = record.event;
    const eventType = stringValue(event.type);
    const modelStepKey = `${stringValue(event.turnId)}:${String(event.step ?? "")}`;
    const rememberAgentStep = (step: Omit<AtifStep, "step_id">) => {
      steps.push(step);
      agentStepsByModelStep.set(modelStepKey, step);
    };
    if (eventType === "content.part" && isRecord(event.part)) {
      const partType = stringValue(event.part.type);
      if (partType === "text") {
        const text = cleanMessageText(stringValue(event.part.text));
        if (text) {
          rememberAgentStep({
            timestamp,
            source: "agent",
            message: text,
            extra: { record_type: type, event_type: eventType },
          });
        }
      } else if (partType === "think") {
        const reasoning = cleanMessageText(stringValue(event.part.think));
        if (reasoning) {
          rememberAgentStep({
            timestamp,
            source: "agent",
            message: "Reasoning",
            reasoning_content: reasoning,
            extra: { record_type: type, event_type: eventType },
          });
        }
      }
      return;
    }
    if (eventType === "tool.call") {
      const name = stringValue(event.name) || "tool";
      rememberAgentStep({
        timestamp,
        source: "agent",
        message: `Tool call: ${name}`,
        tool_calls: [
          {
            tool_call_id: stringValue(event.toolCallId) || `${index}`,
            function_name: name,
            arguments: toolArguments(event.args),
            extra: { description: stringValue(event.description) || undefined },
          },
        ],
        extra: { record_type: type, event_type: eventType },
      });
      return;
    }
    if (eventType === "tool.result") {
      const result = isRecord(event.result) ? event.result : {};
      const content = toolOutputText(result.output);
      steps.push({
        timestamp,
        source: "system",
        message: content || "Tool result",
        observation: {
          results: [
            {
              source_call_id: stringValue(event.toolCallId),
              content:
                content || (result.isError ? "Tool failed" : "Tool result"),
              extra: { is_error: result.isError === true || undefined },
            },
          ],
        },
        extra: { record_type: type, event_type: eventType },
      });
      return;
    }
    if (eventType === "step.end") {
      const metrics = tokenUsageToMetrics(tokenUsageFrom(event.usage));
      const agentStep = agentStepsByModelStep.get(modelStepKey);
      if (agentStep && metrics) agentStep.metrics = metrics;
    }
  });
  return createTrajectory("kimi", file, records, steps);
}

function projectPiTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
  agent = "pi",
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  let modelName = file.modelName || "";

  records.forEach((record, index) => {
    const type = stringValue(record.type);
    if (type === "model_change") {
      modelName = stringValue(record.modelId) || modelName;
      return;
    }
    if (
      agent === "omp" &&
      type === "custom_message" &&
      record.customType === "skill-prompt" &&
      record.attribution === "user"
    ) {
      const details = isRecord(record.details) ? record.details : {};
      const name = stringValue(details.name);
      const args = stringValue(details.args);
      const text =
        stringValue(details.prompt).trim() ||
        (name ? `/skill:${name}${args ? ` ${args}` : ""}` : "");
      if (text) {
        steps.push({
          timestamp: messageTime(record, file.mtimeMs, index),
          source: "user",
          message: text,
          extra: { record_type: type },
        });
      }
      return;
    }
    if (type !== "message" || !isRecord(record.message)) return;

    const message = record.message;
    const role = stringValue(message.role);
    const timestamp = messageTime(record, file.mtimeMs, index);
    if (role === "user") {
      const text = cleanMessageText(textFromContent(message.content));
      if (text) {
        steps.push({
          timestamp,
          source: "user",
          message: text,
          extra: { record_type: type },
        });
      }
      return;
    }

    if (role === "toolResult") {
      const content = toolOutputText(message.content);
      steps.push({
        timestamp,
        source: "system",
        message: content || (message.isError ? "Tool failed" : "Tool result"),
        observation: {
          results: [
            {
              source_call_id: stringValue(message.toolCallId),
              content:
                content || (message.isError ? "Tool failed" : "Tool result"),
              extra: {
                tool_name: stringValue(message.toolName) || undefined,
                is_error: message.isError === true || undefined,
              },
            },
          ],
        },
        extra: { record_type: type },
      });
      return;
    }
    if (role === "bashExecution" || role === "pythonExecution") {
      const isBash = role === "bashExecution";
      const command = stringValue(message.command);
      const code = stringValue(message.code);
      const output = toolOutputText(message.output);
      const exitCode =
        typeof message.exitCode === "number" ? message.exitCode : undefined;
      const cancelled = message.cancelled === true;
      const execution = isBash ? "Command" : "Execution";
      const failed = cancelled || (exitCode !== undefined && exitCode !== 0);
      const status = cancelled
        ? `${execution} cancelled`
        : exitCode !== undefined && exitCode !== 0
          ? `${execution} exited with code ${exitCode}`
          : "";
      const sourceText = isBash
        ? `Ran \`${command}\``
        : `Ran Python:\n\`\`\`python\n${code}\n\`\`\``;
      const outputText = output ? `Output:\n${output}` : "(no output)";
      const content = [sourceText, outputText, status]
        .filter(Boolean)
        .join("\n\n");
      steps.push({
        timestamp,
        source: "system",
        message: content,
        observation: {
          results: [
            {
              content,
              extra: {
                tool_name: isBash ? "bash" : "python",
                command: isBash ? command : undefined,
                code: isBash ? undefined : code,
                exit_code: exitCode,
                cancelled: cancelled || undefined,
                is_error: failed || undefined,
              },
            },
          ],
        },
        extra: { record_type: type, role },
      });
      return;
    }
    if (role !== "assistant") return;

    modelName = stringValue(message.model) || modelName;
    const parts = Array.isArray(message.content)
      ? message.content.filter(isRecord)
      : [];
    const text = cleanMessageText(
      parts
        .filter((part) => part.type === "text")
        .map((part) => stringValue(part.text))
        .filter(Boolean)
        .join("\n"),
    );
    const reasoning = cleanMessageText(
      parts
        .filter((part) => part.type === "thinking")
        .map((part) => stringValue(part.thinking))
        .filter(Boolean)
        .join("\n"),
    );
    const toolCalls = parts
      .filter((part) => part.type === "toolCall")
      .map((part, callIndex) => ({
        tool_call_id: stringValue(part.id) || `${index}:${callIndex}`,
        function_name: stringValue(part.name) || "tool",
        arguments: toolArguments(part.arguments),
      }));
    const errorMessage =
      stringValue(message.stopReason) === "error"
        ? cleanMessageText(stringValue(message.errorMessage)).slice(0, 4096)
        : "";

    // Preserve part boundaries when grouping text before calls would reorder
    // the transcript. Keep the existing compact ATIF shape otherwise.
    const firstCall = parts.findIndex((part) => part.type === "toolCall");
    if (
      firstCall >= 0 &&
      parts
        .slice(firstCall + 1)
        .some((part) => part.type === "text" && stringValue(part.text).trim())
    ) {
      let callIndex = 0;
      const start = steps.length;
      for (const part of parts) {
        if (part.type === "toolCall") {
          const call = toolCalls[callIndex++];
          steps.push({
            timestamp,
            source: "agent",
            message: `Tool call: ${call.function_name}`,
            tool_calls: [call],
          });
        } else if (part.type === "text") {
          const content = cleanMessageText(stringValue(part.text));
          if (content)
            steps.push({ timestamp, source: "agent", message: content });
        } else if (part.type === "thinking") {
          const content = cleanMessageText(stringValue(part.thinking));
          if (content)
            steps.push({
              timestamp,
              source: "agent",
              message: "Reasoning",
              reasoning_content: content,
            });
        }
      }
      if (errorMessage)
        steps.push({
          timestamp,
          source: "agent",
          message: `Error: ${errorMessage}`,
          extra: { error_message: errorMessage },
        });
      if (steps.length > start) {
        const lastStep = steps[steps.length - 1];
        lastStep.metrics = piTokenUsageToMetrics(message.usage);
        lastStep.extra = {
          ...lastStep.extra,
          record_type: type,
          provider: stringValue(message.provider) || undefined,
          model: stringValue(message.model) || undefined,
          stop_reason: stringValue(message.stopReason) || undefined,
        };
      }
      return;
    }

    // Empty retry/error records carry zero-valued usage but no conversation
    // content. Omitting them keeps Timeline focused on observable turns.
    if (!text && !reasoning && toolCalls.length === 0 && !errorMessage) return;
    steps.push({
      timestamp,
      source: "agent",
      message:
        text ||
        (toolCalls.length > 0
          ? `Tool call${toolCalls.length === 1 ? "" : "s"}: ${toolCalls
              .map((call) => call.function_name)
              .join(", ")}`
          : reasoning
            ? "Reasoning"
            : `Error: ${errorMessage}`),
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      metrics: piTokenUsageToMetrics(message.usage),
      extra: {
        record_type: type,
        provider: stringValue(message.provider) || undefined,
        model: stringValue(message.model) || undefined,
        stop_reason: stringValue(message.stopReason) || undefined,
        error_message: errorMessage || undefined,
      },
    });
  });

  return createTrajectory(
    agent,
    modelName ? { ...file, modelName } : file,
    records,
    steps,
    { promptIncludesCached: true },
  );
}

// chat_history.jsonl is Grok's normalized completed-message stream. Projecting
// it avoids the duplicate chunks present in the live updates transcript.
function projectGrokTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  const createdAt = file.createdAtMs ?? file.mtimeMs;
  records.forEach((record, index) => {
    const timestamp = messageTime(record, createdAt, index);
    const type = stringValue(record.type);
    if (type === "user") {
      const text = grokUserMessageText(record);
      if (text) {
        steps.push({
          timestamp,
          source: "user",
          message: text,
          extra: { record_type: type },
        });
      }
      return;
    }
    if (type === "system") {
      const text = cleanMessageText(textFromContent(record.content));
      if (text) {
        steps.push({
          timestamp,
          source: "system",
          message: text,
          extra: { record_type: type },
        });
      }
      return;
    }
    if (type === "reasoning") {
      const reasoning = grokReasoningText(record);
      if (!reasoning) return;
      steps.push({
        timestamp,
        source: "agent",
        message: "Reasoning",
        reasoning_content: reasoning,
        extra: {
          record_type: type,
          status: stringValue(record.status) || undefined,
        },
      });
      return;
    }
    if (type === "assistant") {
      const text = cleanMessageText(textFromContent(record.content));
      const toolCalls = Array.isArray(record.tool_calls)
        ? record.tool_calls.filter(isRecord).map((call, callIndex) => ({
            tool_call_id: stringValue(call.id) || `${index}:${callIndex}`,
            function_name: stringValue(call.name) || "tool",
            arguments: toolArguments(call.arguments),
          }))
        : [];
      if (!text && toolCalls.length === 0) return;
      steps.push({
        timestamp,
        source: "agent",
        message:
          text ||
          `Tool call${toolCalls.length === 1 ? "" : "s"}: ${toolCalls
            .map((call) => call.function_name)
            .join(", ")}`,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        metrics: tokenUsageToMetrics(tokenUsageForRecord(record).usage),
        extra: { record_type: type, model: file.modelName },
      });
      return;
    }
    if (type === "tool_result") {
      const content = toolOutputText(record.content);
      steps.push({
        timestamp,
        source: "system",
        message: content || "Tool result",
        observation: {
          results: [
            {
              source_call_id: stringValue(record.tool_call_id),
              content: content || "Tool result",
              extra: toolResultExtra(record),
            },
          ],
        },
        extra: { record_type: type },
      });
    }
  });
  return createTrajectory("grok", file, records, steps);
}

function projectMuseTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  const acceptedIntents = new Set<string>();
  const materializedRuns = new Map<string, string>();
  const failedTools = new Set<string>();
  const readUsage = createTokenUsageReader();
  let sessionId = file.sessionId;
  let modelName = file.modelName;
  let agentVersion = file.agentVersion;
  for (const record of records) {
    if (!isRecord(record.payload)) continue;
    const payload = record.payload;
    if (
      record.payload_type === "runtime.user_intent.materialized" &&
      isRecord(payload.outcome)
    ) {
      materializedRuns.set(
        stringValue(payload.outcome.run_id),
        stringValue(payload.intent_id),
      );
    }
    if (
      record.payload_type === "tool_batch.effect.terminal" &&
      isRecord(payload.record) &&
      isRecord(payload.record.outcome) &&
      payload.record.outcome.kind === "failed"
    ) {
      failedTools.add(
        JSON.stringify([
          stringValue(payload.run_id),
          stringValue(payload.record.call_id),
        ]),
      );
    }
  }
  records.forEach((record, index) => {
    const usage = readUsage(record).usage;
    if (!isRecord(record.payload)) return;
    const payload = record.payload;
    const type = stringValue(record.payload_type);
    if (isRecord(record.stream) && record.stream.kind === "session")
      sessionId ||= stringValue(record.stream.id);
    if (type === "runtime.session.metadata" && isRecord(payload.record)) {
      modelName = stringValue(payload.record.model_id) || modelName;
      if (isRecord(payload.record.build))
        agentVersion = stringValue(payload.record.build.semver) || agentVersion;
      return;
    }
    // Muse's recorded_at is Unix microseconds, not milliseconds.
    const ms =
      typeof record.recorded_at === "number"
        ? Math.floor(record.recorded_at / 1000)
        : NaN;
    const timestamp =
      Number.isFinite(ms) && Math.abs(ms) <= 8.64e15
        ? new Date(ms).toISOString()
        : messageTime(record, file.mtimeMs, index);
    if (type === "runtime.user_intent.accepted") {
      const text = cleanMessageText(textFromContent(payload.model_messages));
      if (text) {
        steps.push({ timestamp, source: "user", message: text });
        const id = stringValue(payload.intent_id);
        if (id) acceptedIntents.add(id);
      }
      return;
    }
    if (
      type !== "runtime.session" ||
      payload.kind !== "run" ||
      !isRecord(payload.event)
    )
      return;
    const event = payload.event;
    if (event.kind === "started") {
      const runId = stringValue(payload.run_id);
      if (
        acceptedIntents.has(runId) ||
        acceptedIntents.has(materializedRuns.get(runId) ?? "")
      )
        return;
      const text = cleanMessageText(stringValue(event.prompt));
      if (text) steps.push({ timestamp, source: "user", message: text });
    } else if (event.kind === "assistant_message_committed") {
      const text = cleanMessageText(stringValue(event.text));
      if (text) steps.push({ timestamp, source: "agent", message: text });
    } else if (event.kind === "reasoning_committed") {
      const text = cleanMessageText(stringValue(event.text));
      if (text)
        steps.push({
          timestamp,
          source: "agent",
          message: "Reasoning",
          reasoning_content: text,
        });
    } else if (
      event.kind === "assistant_tool_calls_committed" &&
      Array.isArray(event.tool_calls)
    ) {
      for (const call of event.tool_calls.filter(isRecord)) {
        const name = stringValue(call.name) || "tool";
        steps.push({
          timestamp,
          source: "agent",
          message: `Tool call: ${name}`,
          tool_calls: [
            {
              tool_call_id:
                stringValue(call.call_id) ||
                stringValue(call.id) ||
                `${index}:${steps.length}`,
              function_name: name,
              arguments: toolArguments(call.args),
            },
          ],
        });
      }
    } else if (
      event.kind === "tool_result_batch_committed" &&
      Array.isArray(event.results)
    ) {
      for (const result of event.results.filter(isRecord)) {
        const content = stringValue(result.text);
        steps.push({
          timestamp,
          source: "system",
          message: content || "Tool result",
          observation: {
            results: [
              {
                source_call_id: stringValue(result.tool_call_id),
                content,
                extra: {
                  is_error:
                    failedTools.has(
                      JSON.stringify([
                        stringValue(payload.run_id),
                        stringValue(result.tool_call_id),
                      ]),
                    ) || toolResultExtra(result).is_error,
                },
              },
            ],
          },
        });
      }
    } else if (event.kind === "terminal" && event.terminal === "failed") {
      const error =
        cleanMessageText(stringValue(event.reason)) || "Muse run failed";
      steps.push({
        timestamp,
        source: "agent",
        message: `Error: ${error}`,
        extra: { error_message: error },
      });
    } else if (event.kind === "model_completed") {
      modelName = stringValue(event.model) || modelName;
      const metrics = tokenUsageToMetrics(usage);
      if (metrics)
        steps.push({
          timestamp,
          source: "system",
          message: "Token usage",
          metrics,
        });
    }
  });
  return createTrajectory(
    "muse",
    { ...file, sessionId, modelName, agentVersion },
    records,
    steps,
  );
}

function projectAntigravityTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  const createdAt = file.createdAtMs ?? file.mtimeMs;
  records.forEach((record, index) => {
    try {
      const timestamp = messageTime(record, createdAt, index);
      const type = stringValue(record.type);
      if (type === "user") {
        const text = cleanMessageText(textFromContent(record.content));
        if (text) {
          steps.push({
            timestamp,
            source: "user",
            message: text,
            extra: { record_type: type },
          });
        }
        return;
      }
      if (type === "system") {
        const text = cleanMessageText(textFromContent(record.content));
        if (text) {
          steps.push({
            timestamp,
            source: "system",
            message: text,
            extra: { record_type: type },
          });
        }
        return;
      }
      if (type === "reasoning") {
        const reasoning = cleanMessageText(
          textFromContent(record.summary ?? record.content),
        );
        if (!reasoning) return;
        steps.push({
          timestamp,
          source: "agent",
          message: "Reasoning",
          reasoning_content: reasoning,
          metrics: tokenUsageToMetrics(tokenUsageForRecord(record).usage),
          extra: {
            record_type: type,
            model: file.modelName,
          },
        });
        return;
      }
      if (type === "assistant") {
        const text = cleanMessageText(textFromContent(record.content));
        const toolCalls = Array.isArray(record.tool_calls)
          ? record.tool_calls.filter(isRecord).map((call, callIndex) => ({
              tool_call_id: stringValue(call.id) || `${index}:${callIndex}`,
              function_name: stringValue(call.name) || "tool",
              arguments: toolArguments(call.arguments),
            }))
          : [];
        const reasoning = cleanMessageText(textFromContent(record.reasoning));
        const errorMessage = stringValue(record.error_message);
        if (!text && toolCalls.length === 0 && !reasoning && !errorMessage)
          return;
        steps.push({
          timestamp,
          source: "agent",
          message:
            text ||
            (toolCalls.length > 0
              ? `Tool call${toolCalls.length === 1 ? "" : "s"}: ${toolCalls
                  .map((call) => call.function_name)
                  .join(", ")}`
              : errorMessage || "Assistant message"),
          reasoning_content: reasoning || undefined,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          metrics: tokenUsageToMetrics(tokenUsageForRecord(record).usage),
          extra: {
            record_type: type,
            model: file.modelName,
            error_message: errorMessage || undefined,
          },
        });
        return;
      }
      if (type === "tool_result") {
        const content = toolOutputText(record.content);
        steps.push({
          timestamp,
          source: "system",
          message: content || "Tool result",
          observation: {
            results: [
              {
                source_call_id: stringValue(record.tool_call_id),
                content: content || "Tool result",
                extra: {
                  tool_name: stringValue(record.tool_name) || undefined,
                  is_error: record.is_error === true,
                },
              },
            ],
          },
          extra: { record_type: type },
        });
      }
    } catch {
      // Fail soft on malformed record
    }
  });
  return createTrajectory("agy", file, records, steps);
}

export function projectAgentTrajectory(
  agent: string,
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  if (agent === "codex") return projectCodexTrajectory(file, records);
  if (agent === "claude") return projectClaudeTrajectory(file, records);
  if (agent === "kimi") return projectKimiTrajectory(file, records);
  if (agent === "grok") return projectGrokTrajectory(file, records);
  if (agent === "pi" || agent === "omp")
    return projectPiTrajectory(file, records, agent);
  if (agent === "muse") return projectMuseTrajectory(file, records);
  if (agent === "agy") return projectAntigravityTrajectory(file, records);
  return createTrajectory(agent, file, records, []);
}
