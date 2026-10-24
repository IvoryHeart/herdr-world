import { basename } from "node:path";

export { normalizeAgentName } from "./chat-harnesses";

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function integrationInstallCommand(agent: string) {
  if (agent === "agy") return "herdr integration install antigravity-cli";
  return `herdr integration install ${agent}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromContent(item))
      .filter(Boolean)
      .join("\n");
  }
  if (!isRecord(value)) return "";
  const type = stringValue(value.type);
  if (
    type === "tool_result" ||
    type === "tool_use" ||
    type === "function_call" ||
    type === "function_call_output" ||
    type === "thinking" ||
    type === "think"
  ) {
    return "";
  }
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string" || Array.isArray(value.content)) {
    return textFromContent(value.content);
  }
  return "";
}

export function cleanMessageText(value: string) {
  // A slash command with arguments reads as what was typed: `/name args`.
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(value)?.[1];
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(value)?.[1];
  const rest = value
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const typed = args?.trim()
    ? [command?.trim(), args.trim()].filter(Boolean).join(" ")
    : "";
  const text = [typed, rest].filter(Boolean).join("\n\n");
  if (text === "[Request interrupted by user]") return "";
  return text;
}

export function stableMessageId(path: string, index: number) {
  return `${basename(path)}:${index}`;
}

export function messageTime(
  record: Record<string, unknown>,
  fallbackMs: number,
  index: number,
) {
  const parsed = timestampMs(record, fallbackMs, index);
  return new Date(parsed).toISOString();
}

function timestampValueMs(value: unknown) {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (Number.isFinite(raw) && raw > 0) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return NaN;
  return new Date(value).getTime();
}

export function timestampMs(
  record: Record<string, unknown>,
  fallbackMs: number,
  index: number,
) {
  const parsed =
    timestampValueMs(record.ts) ||
    timestampValueMs(record.timestamp) ||
    timestampValueMs(record.time) ||
    timestampValueMs(record.created_at) ||
    timestampValueMs(record.createdAt);
  const ms = Number.isFinite(parsed) ? parsed : fallbackMs + index;
  return ms;
}

export async function readJsonl(path: string) {
  const text = await Bun.file(path).text();
  const records: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // Session files are append-only JSONL. Ignore incomplete trailing records.
    }
  }
  return records;
}
