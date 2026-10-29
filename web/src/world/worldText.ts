export function boundedLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? boundedCodePointPrefix(normalized, 100) : fallback;
}

function boundedCodePointPrefix(value: string, limit: number) {
  // Most admitted labels already fit. Their UTF-16 length is an upper bound
  // on code points, so retain the string instead of allocating per character.
  if (value.length <= limit) return value;
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= limit) break;
    result += character;
    length += 1;
  }
  return result;
}

export function agentThreadTitle(
  value: unknown,
  agent: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/^[\s\u2800-\u28ff✳✶✻✽✢·*•◐◓◑◒⏺]+/u, "")
    .split(" | ")[0]
    ?.trim();
  if (!cleaned) return undefined;
  if (
    typeof agent === "string" &&
    cleaned.toLowerCase() === agent.toLowerCase()
  )
    return undefined;
  return boundedCodePointPrefix(cleaned, 120);
}

export function boundedOptionalText(
  value: unknown,
  limit: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized
    ? boundedCodePointPrefix(normalized, limit).trimEnd()
    : undefined;
}
