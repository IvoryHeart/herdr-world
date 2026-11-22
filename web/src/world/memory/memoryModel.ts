import { memoryHarness } from "../../../../shared/memory";
import type {
  MemoryAgent,
  MemoryCatalog,
  MemoryEntry,
  MemoryHarness,
  MemorySource,
} from "../../../../shared/memory";

/**
 * What the Library (#1027) shows, from one host's memory catalog: who reads
 * (projects and their agents), the shelves (sources) by reach, their books
 * (entries) and, for one agent, what it would load. Pure, so the dialog,
 * the Town sign and the tests share it. Sources are candidates for an
 * agent's next load, never a receipt of what it has loaded (docs/memory-api.md).
 */

/** A reader: everything on the host, one project, or one agent. */
export type MemoryReader =
  | { kind: "all" }
  | { kind: "project"; id: string }
  | { kind: "agent"; id: string };

export const ALL_READERS: MemoryReader = { kind: "all" };

export type MemoryLoadMode = MemorySource["load"] | "shadowed" | "empty";

const HARNESS_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
  opencode: "OpenCode",
  copilot: "GitHub Copilot CLI",
  cursor: "Cursor",
  qwen: "Qwen Code",
  droid: "Droid",
  kimi: "Kimi",
  omp: "oh-my-pi",
  kilo: "Kilo",
  hermes: "Hermes",
  qodercli: "Qoder CLI",
  "antigravity-cli": "Antigravity CLI",
  grok: "Grok",
  devin: "Devin",
  mastracode: "Mastra Code",
};

export function harnessLabel(harness: string | null | undefined) {
  if (!harness) return "Unknown agent";
  return (
    HARNESS_LABELS[harness] ?? harness[0]!.toUpperCase() + harness.slice(1)
  );
}

export const LOAD_LABELS: Record<MemoryLoadMode, string> = {
  "startup-candidate": "Loads at start",
  "on-demand": "Read when needed",
  shadowed: "Hidden by another file",
  empty: "Empty, skipped",
};

export const KIND_LABELS: Record<MemorySource["kind"], string> = {
  instructions: "Instructions",
  rules: "Rules",
  memory: "Memory",
};

export const SCOPE_SHELVES: Record<
  MemorySource["scope"],
  { title: string; hint: string }
> = {
  user: { title: "Yours", hint: "Every project on this host" },
  project: { title: "Projects", hint: "One project's folder" },
  agent: { title: "Agents", hint: "One agent's own notes" },
};

/** Bytes as people read them: 812 B, 4.2 KB, 1.3 MB. */
export function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000)
    return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** An age as a short phrase: "just now", "5 min ago", "3 days ago". */
export function formatAge(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** The last segments of a host path, for a label; the full path is a title. */
export function shortPath(path: string, segments = 2) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join("/")}`;
}

export const entryKey = (entry: { source_id: string; path: string }) =>
  `${entry.source_id}\u0000${entry.path}`;

/** Names World knows for the host's agents (pane ID → name), if any. */
export type MemoryAgentNames = Readonly<Record<string, string>>;

export function agentDisplayName(
  agent: Pick<MemoryAgent, "id" | "harness">,
  names: MemoryAgentNames = {},
) {
  return names[agent.id] ?? `${harnessLabel(agent.harness)} ${agent.id}`;
}

function projectLabel(catalog: MemoryCatalog, id: string) {
  return catalog.projects.find((project) => project.id === id)?.label ?? id;
}

/** Does `reader` read `source`? */
export function readsSource(reader: MemoryReader, source: MemorySource) {
  if (reader.kind === "all") return true;
  if (reader.kind === "project") return source.project_ids.includes(reader.id);
  return source.agent_ids.includes(reader.id);
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export type MemoryReaderRow = {
  reader: MemoryReader;
  label: string;
  detail: string;
  /** Files this reader can see. */
  files: number;
  stale: number;
  agents?: MemoryReaderRow[];
};

/** Files and stale files in the sources `reader` reads. */
function counts(catalog: MemoryCatalog, reader: MemoryReader) {
  const sources = new Set(
    catalog.sources.filter((s) => readsSource(reader, s)).map((s) => s.id),
  );
  let files = 0;
  let stale = 0;
  for (const entry of catalog.entries) {
    if (!sources.has(entry.source_id)) continue;
    files += 1;
    if (entry.stale) stale += 1;
  }
  return { files, stale };
}

/** The reader list: everything, then each project with its agents. */
export function readerRows(
  catalog: MemoryCatalog,
  names: MemoryAgentNames = {},
): MemoryReaderRow[] {
  const supported = catalog.agents.filter((agent) =>
    memoryHarness(agent.harness),
  );
  const projects = catalog.projects.filter((project) =>
    supported.some((agent) => agent.project_id === project.id),
  );
  if (!projects.length) return [];
  const rows: MemoryReaderRow[] = [
    {
      reader: ALL_READERS,
      label: "Everything",
      detail:
        plural(projects.length, "project") +
        ", " +
        plural(supported.length, "agent"),
      ...counts(catalog, ALL_READERS),
    },
  ];
  for (const project of projects) {
    const reader: MemoryReader = { kind: "project", id: project.id };
    // Shells have no harness and read no memory; they stay off the list.
    const agents = supported
      .filter((agent) => agent.project_id === project.id)
      .map((agent): MemoryReaderRow => {
        const own: MemoryReader = { kind: "agent", id: agent.id };
        return {
          reader: own,
          label: agentDisplayName(agent, names),
          detail: harnessLabel(agent.harness),
          ...counts(catalog, own),
        };
      });
    rows.push({
      reader,
      label: project.label,
      detail: shortPath(project.path),
      ...counts(catalog, reader),
      agents,
    });
  }
  return rows;
}

export function sameReader(a: MemoryReader, b: MemoryReader) {
  return (
    a.kind === b.kind && (a.kind === "all" || a.id === (b as { id: string }).id)
  );
}

/** Who reads a source, in words: "Shared by 3 agents in 2 projects". */
export function sharingText(
  source: MemorySource,
  catalog: MemoryCatalog,
  names: MemoryAgentNames = {},
) {
  const agents = source.agent_ids.length;
  const projects = source.project_ids.length;
  if (agents === 0 && projects === 0) return "No agent reads it now";
  if (agents === 1) {
    const agent = catalog.agents.find((a) => a.id === source.agent_ids[0]);
    const who = agent ? agentDisplayName(agent, names) : "One agent";
    return projects > 1 ? `${who}, across ${projects} projects` : `Only ${who}`;
  }
  if (agents === 0)
    return projects === 1
      ? `${projectLabel(catalog, source.project_ids[0]!)}, no agent yet`
      : `${projects} projects, no agent yet`;
  return projects > 1
    ? `Shared by ${agents} agents in ${projects} projects`
    : `Shared by ${agents} agents`;
}

/** The names of the agents and projects reading a source, for its reader. */
export function sharingList(
  source: MemorySource,
  catalog: MemoryCatalog,
  names: MemoryAgentNames = {},
) {
  return {
    projects: source.project_ids.map((id) => projectLabel(catalog, id)),
    agents: source.agent_ids.map((id) => {
      const agent = catalog.agents.find((a) => a.id === id);
      return agent ? agentDisplayName(agent, names) : id;
    }),
  };
}

export type MemoryShelf = {
  source: MemorySource;
  entries: MemoryEntry[];
  bytes: number;
};

export type MemoryWing = {
  scope: MemorySource["scope"];
  title: string;
  hint: string;
  shelves: MemoryShelf[];
};

const KIND_ORDER: Record<MemorySource["kind"], number> = {
  instructions: 0,
  rules: 1,
  memory: 2,
};

/**
 * The shelves `reader` reads, in wings by reach (yours, projects, agents),
 * instructions first; books by name with an index first.
 */
export function libraryWings(
  catalog: MemoryCatalog,
  reader: MemoryReader,
): MemoryWing[] {
  const entries = new Map<string, MemoryEntry[]>();
  for (const entry of catalog.entries) {
    const list = entries.get(entry.source_id) ?? [];
    list.push(entry);
    entries.set(entry.source_id, list);
  }
  const wings: MemoryWing[] = [];
  for (const scope of ["user", "project", "agent"] as const) {
    const shelves = catalog.sources
      .filter((source) => source.scope === scope && readsSource(reader, source))
      .sort(
        (a, b) =>
          KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
          a.path.localeCompare(b.path),
      )
      .map((source): MemoryShelf => {
        const books = (entries.get(source.id) ?? []).sort(
          (a, b) =>
            Number(b.path === "MEMORY.md") - Number(a.path === "MEMORY.md") ||
            a.path.localeCompare(b.path),
        );
        return {
          source,
          entries: books,
          bytes: books.reduce((sum, entry) => sum + entry.size, 0),
        };
      });
    if (shelves.length) wings.push({ scope, ...SCOPE_SHELVES[scope], shelves });
  }
  return wings;
}

/** How one harness takes a book: its own mode, else the source's timing. */
export function entryLoad(
  entry: MemoryEntry,
  harness: string | null | undefined,
): MemoryLoadMode | null {
  if (!harness) return null;
  return entry.harness_loads[harness as MemoryHarness]?.mode ?? null;
}

/** Each harness reading a book and how, for its badges. */
export function entryLoads(entry: MemoryEntry) {
  return (Object.keys(entry.harness_loads) as MemoryHarness[])
    .sort()
    .map((harness) => ({
      harness,
      label: harnessLabel(harness),
      mode: entry.harness_loads[harness]!.mode,
      reason: entry.harness_loads[harness]!.reason,
    }));
}

export type MemoryAgentLoad = {
  agent: MemoryAgent;
  startup: MemoryEntry[];
  onDemand: MemoryEntry[];
  skipped: MemoryEntry[];
  startupBytes: number;
};

/**
 * What one agent would load next time it starts, by its harness's modes:
 * candidates, never a receipt of its context. Null for an unknown agent.
 */
export function agentLoad(
  catalog: MemoryCatalog,
  agentId: string,
): MemoryAgentLoad | null {
  const agent = catalog.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  const sources = new Set(
    catalog.sources
      .filter((s) => s.agent_ids.includes(agentId))
      .map((s) => s.id),
  );
  const load: MemoryAgentLoad = {
    agent,
    startup: [],
    onDemand: [],
    skipped: [],
    startupBytes: 0,
  };
  for (const entry of catalog.entries) {
    if (!sources.has(entry.source_id)) continue;
    const mode = entryLoad(entry, agent.harness) ?? entry.load;
    if (entry.state !== "available" || mode === "shadowed" || mode === "empty")
      load.skipped.push(entry);
    else if (mode === "startup-candidate") {
      load.startup.push(entry);
      load.startupBytes += entry.size;
    } else load.onDemand.push(entry);
  }
  return load;
}

/** The catalog in one line, for the Town sign and the hub's detail. */
export function memorySummary(catalog: MemoryCatalog) {
  const files = catalog.entries.length;
  const stale = catalog.entries.filter((entry) => entry.stale).length;
  const shared = catalog.sources.filter((s) => s.agent_ids.length > 1).length;
  return { files, stale, shared };
}

/** A shelf's entry names: the basename for a file, relative Markdown in a folder. */
export function newEntryName(
  source: MemorySource,
  name: string,
): string | null {
  if (source.shape === "file") return null;
  const trimmed = name.trim().replace(/^\.\/+/, "");
  if (!trimmed || trimmed.length > 200) return null;
  if (trimmed.startsWith("/") || trimmed.includes("\\")) return null;
  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (parts.length > 4) return null;
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** The file a missing file source would create. */
export function fileSourceName(source: MemorySource) {
  const parts = source.path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? source.path;
}
