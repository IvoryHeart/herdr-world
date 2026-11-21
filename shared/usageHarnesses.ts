/**
 * The usage reader seam (#1029): what World can read about each harness's
 * usage. Every harness World supports gets World's own measurement (time at
 * work and waiting on you, and runs, from agent status); a harness listed
 * here also has a reader for what it records itself. Tokens and cost of any
 * other harness are not available, never zero. Later analysers plug in here.
 */
export type UsageReader = {
  /** Token counts (and any recorded cost) from the harness's session logs. */
  tokens: "session-log" | null;
  /** Subscription windows, from where the harness records them. */
  limits: "status-line" | "session-log" | null;
};

/** Harnesses whose session logs the host reader counts tokens from. */
export const USAGE_TOKEN_HARNESSES = [
  "claude",
  "codex",
  "pi",
  "gemini",
] as const;

const READERS: Readonly<Record<string, UsageReader>> = {
  claude: { tokens: "session-log", limits: "status-line" },
  codex: { tokens: "session-log", limits: "session-log" },
  pi: { tokens: "session-log", limits: null },
  gemini: { tokens: "session-log", limits: null },
};
const WORLD_ONLY: UsageReader = { tokens: null, limits: null };

/** The readers for one harness (World's own measurement always applies). */
export function usageReader(harness: string | null | undefined): UsageReader {
  return (
    (harness &&
      Object.prototype.hasOwnProperty.call(READERS, harness) &&
      READERS[harness]) ||
    WORLD_ONLY
  );
}

/** True when World can count this harness's tokens. */
export const usageReadsTokens = (harness: string | null | undefined) =>
  usageReader(harness).tokens !== null;
