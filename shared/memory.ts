/** Private host data. Never store these responses in Board documents or telemetry. */
export const MEMORY_LIMITS = {
  projects: 32,
  agents: 128,
  sources: 256,
  entries: 512,
  depth: 4,
  file_bytes: 256 * 1024,
  search_bytes: 2 * 1024 * 1024,
  search_results: 100,
  query_chars: 200,
  stale_ms: 30 * 24 * 60 * 60 * 1000,
  timeout_ms: 15_000,
} as const;

export const MEMORY_ACTIONS = [
  "list",
  "search",
  "read",
  "create",
  "update",
  "delete",
] as const;
export type MemoryAction = (typeof MEMORY_ACTIONS)[number];
export type MemoryHarness = "claude" | "codex" | "pi";
export type MemoryTarget = {
  connection_id: string;
  connection_generation: number;
};
export type MemoryProject = { id: string; label: string; path: string };
export type MemoryAgent = {
  id: string;
  project_id: string;
  harness: string | null;
  path: string;
};
export type MemorySource = {
  id: string;
  harnesses: MemoryHarness[];
  kind: "instructions" | "rules" | "memory";
  scope: "user" | "project" | "agent";
  path: string;
  shape: "file" | "directory";
  /** Candidate load timing, never a receipt from a running harness. */
  load: "startup-candidate" | "on-demand";
  description: string;
  details: Partial<Record<MemoryHarness, string>>;
  project_ids: string[];
  agent_ids: string[];
  state: "available" | "missing" | "refused";
  reason?: string;
};
export type MemoryEntry = {
  /** Connection-local identity derived from the absolute path, not contents. */
  id: string;
  source_id: string;
  path: string;
  size: number;
  modified_at: number;
  age_ms: number;
  stale: boolean;
  state: "available" | "refused";
  reason?: string;
  load: MemorySource["load"];
  harness_loads: Partial<
    Record<
      MemoryHarness,
      { mode: MemorySource["load"] | "shadowed" | "empty"; reason?: string }
    >
  >;
};
export type MemoryCatalog = MemoryTarget & {
  observed_at: number;
  projects: MemoryProject[];
  agents: MemoryAgent[];
  sources: MemorySource[];
  entries: MemoryEntry[];
  unsupported: { agent_id: string; harness: string | null; reason: string }[];
  warnings: string[];
  truncated: boolean;
  limits: typeof MEMORY_LIMITS;
};
export type MemoryRead = MemoryTarget & {
  source_id: string;
  path: string;
  content: string;
  revision: string;
  size: number;
  modified_at: number;
};
export type MemorySearch = MemoryTarget & {
  query: string;
  matches: { entry: MemoryEntry; line: number; excerpt: string }[];
  scanned_bytes: number;
  skipped: number;
  truncated: boolean;
};
export type MemoryMutation = MemoryTarget & {
  source_id: string;
  path: string;
  status: "created" | "updated" | "deleted";
  revision: string | null;
};
export type MemoryFailure =
  | "invalid"
  | "unavailable"
  | "not_found"
  | "refused"
  | "conflict"
  | "too_large"
  | "uncertain";
export class MemoryError extends Error {
  constructor(
    public readonly code: MemoryFailure,
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}
