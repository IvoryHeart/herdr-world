import type { Family } from "./usage-records";

export type RawRecord = Record<string, any>;
export function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value)
    ? value
        .filter(
          (part) =>
            (part?.type === "text" || part?.type === "input_text") &&
            typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n")
    : "";
}
export function prMentions(text: string): number[] {
  return [
    ...new Set(
      [...text.matchAll(/(?:^|[^\w])#([1-9]\d*)\b/g)].map((m) => Number(m[1])),
    ),
  ];
}
export function isoTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid usage timestamp");
  return new Date(value).toISOString();
}
/** A null item preserves the position of a damaged complete Claude record. */
export function decodeRecords(
  lines: string,
  family: Family,
): Array<RawRecord | null> {
  const records: Array<RawRecord | null> = [];
  const pieces = lines.split("\n");
  for (let index = 0; index < pieces.length; index++) {
    const line = pieces[index]!;
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      if (index === pieces.length - 1) continue;
      if (family === "codex") throw new Error("Malformed session JSONL record");
      records.push(null);
      continue;
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      if (family === "codex") throw new Error("Malformed session JSONL record");
      records.push(null);
      continue;
    }
    records.push(record as RawRecord);
  }
  return records;
}
