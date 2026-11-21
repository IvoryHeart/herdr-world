import {
  MEMORY_LIMITS,
  type MemoryCatalog,
  type MemoryEntry,
  type MemoryHarness,
  type MemorySource,
  type MemoryTarget,
} from "../../../../shared/memory";
import type { MemoryClient } from "./memoryClient";

/**
 * A testing-only switch for the Library (#1027): open World with
 * `?memoryFixture` and the Library reads a synthetic host's memory, kept in
 * this page only, instead of any real host's. The page drops the parameter
 * at once; a reload ends it. It has every state worth seeing: shared and
 * stale files, a file another hides, an empty one, a refused one, a missing
 * file to create, a missing memory folder whose first note creates it and
 * an agent whose harness has no reader. Edits, adds and
 * deletes work and conflicts can be forced (`memoryFixtureTouch`); saving
 * text with `[uncertain]` in it acts out a lost, uncertain write. Paths
 * are synthetic and nothing reaches a host.
 */

const PARAM = "memoryFixture";
/**
 * Saving text that contains this makes the synthetic host lose the write,
 * change the file as another editor would and answer "uncertain".
 */
export const UNCERTAIN_MARK = "[uncertain]";
let on: boolean | undefined;
let unsupportedOnly = false;

export function memoryFixtureHasMemory() {
  return !unsupportedOnly;
}

/** The switch, read once per page load; the parameter is removed. */
export function memoryFixtureOn(): boolean {
  if (on !== undefined) return on;
  on = false;
  if (typeof location === "undefined") return on;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return on;
  on = true;
  unsupportedOnly = url.searchParams.get(PARAM) === "unsupported";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return on;
}

/** For tests: set the switch (undefined: read the URL again). */
export function setMemoryFixtureForTests(
  value: boolean | undefined,
  unsupported = false,
) {
  unsupportedOnly = unsupported;
  on = value;
  library = null;
}

export const MEMORY_FIXTURE_TARGET: MemoryTarget & { label: string } = {
  connection_id: "memory-fixture",
  connection_generation: 1,
  label: "Example host",
};

/** Names World would show for the synthetic agents. */
export const MEMORY_FIXTURE_AGENT_NAMES: Record<string, string> = {
  p1: "web-builder",
  p2: "web-reviewer",
  p3: "docs-writer",
  p4: "helper",
  p5: "opencode-builder",
};

const DAY = 24 * 60 * 60 * 1000;
const HOME = "/users/example";

type FixtureFile = { content: string; modified: number; revision: number };
type FixtureSource = Omit<MemorySource, "state"> & {
  refused?: string;
  /** A folder that does not exist yet (until a note is created in it). */
  absent?: boolean;
  /** Per-file harness modes other than the source's timing. */
  modes?: Record<
    string,
    Partial<Record<MemoryHarness, MemoryEntry["harness_loads"][MemoryHarness]>>
  >;
};

type FixtureLibrary = {
  sources: FixtureSource[];
  files: Map<string, FixtureFile>;
  revision: number;
};

let library: FixtureLibrary | null = null;

const key = (sourceId: string, path: string) => `${sourceId}\u0000${path}`;

function source(
  fields: Omit<FixtureSource, "details" | "description"> &
    Partial<Pick<FixtureSource, "details" | "description">>,
): FixtureSource {
  return { description: "", details: {}, ...fields };
}

function seed(now: number): FixtureLibrary {
  const sources: FixtureSource[] = [
    source({
      id: "fx-opencode-user",
      harnesses: ["opencode"],
      kind: "instructions",
      scope: "user",
      path: `${HOME}/.config/opencode/AGENTS.md`,
      shape: "file",
      load: "startup-candidate",
      description: "OpenCode user instructions for every project",
      project_ids: ["w3"],
      agent_ids: ["p5"],
    }),
    source({
      id: "fx-opencode-project",
      harnesses: ["opencode"],
      kind: "instructions",
      scope: "project",
      path: "/workspace/opencode-app/AGENTS.md",
      shape: "file",
      load: "startup-candidate",
      description: "OpenCode project instructions",
      project_ids: ["w3"],
      agent_ids: ["p5"],
    }),
    source({
      id: "fx-claude-user",
      harnesses: ["claude"],
      kind: "instructions",
      scope: "user",
      path: `${HOME}/.claude/CLAUDE.md`,
      shape: "file",
      load: "startup-candidate",
      description: "Your Claude instructions for every project",
      project_ids: ["w1", "w2"],
      agent_ids: ["p1", "p3"],
    }),
    source({
      id: "fx-codex-user",
      harnesses: ["codex"],
      kind: "instructions",
      scope: "user",
      path: `${HOME}/.codex/AGENTS.md`,
      shape: "file",
      load: "startup-candidate",
      description: "Your Codex instructions for every project",
      project_ids: ["w1"],
      agent_ids: ["p2"],
    }),
    source({
      id: "fx-codex-memories",
      harnesses: ["codex"],
      kind: "memory",
      scope: "user",
      path: `${HOME}/.codex/memories`,
      shape: "directory",
      load: "on-demand",
      description: "Codex's generated recall",
      details: {
        codex: "Codex may rewrite these; per-chat settings decide use",
      },
      project_ids: ["w1"],
      agent_ids: ["p2"],
    }),
    source({
      id: "fx-web-agents",
      harnesses: ["claude", "codex"],
      kind: "instructions",
      scope: "project",
      path: "/workspace/web-app/AGENTS.md",
      shape: "file",
      load: "startup-candidate",
      description: "The project's shared agent instructions",
      details: {
        claude: "Claude reads it only when the folder has no CLAUDE.md",
      },
      project_ids: ["w1"],
      agent_ids: ["p1", "p2"],
      modes: {
        "AGENTS.md": {
          claude: {
            mode: "shadowed",
            reason: "CLAUDE.md in the same folder comes first",
          },
        },
      },
    }),
    source({
      id: "fx-web-claude",
      harnesses: ["claude"],
      kind: "instructions",
      scope: "project",
      path: "/workspace/web-app/CLAUDE.md",
      shape: "file",
      load: "startup-candidate",
      description: "The project's Claude instructions",
      project_ids: ["w1"],
      agent_ids: ["p1"],
    }),
    source({
      id: "fx-web-rules",
      harnesses: ["claude"],
      kind: "rules",
      scope: "project",
      path: "/workspace/web-app/.claude/rules",
      shape: "directory",
      load: "startup-candidate",
      description: "The project's Claude rules",
      project_ids: ["w1"],
      agent_ids: ["p1"],
    }),
    source({
      id: "fx-web-memory",
      harnesses: ["claude"],
      kind: "memory",
      scope: "project",
      path: `${HOME}/.claude/projects/-workspace-web-app/memory`,
      shape: "directory",
      load: "startup-candidate",
      description: "Claude's auto memory for this project",
      details: { claude: "MEMORY.md loads at start; topic files when needed" },
      project_ids: ["w1"],
      agent_ids: ["p1"],
    }),
    source({
      id: "fx-docs-agents",
      harnesses: ["claude"],
      kind: "instructions",
      scope: "project",
      path: "/workspace/docs-site/AGENTS.md",
      shape: "file",
      load: "startup-candidate",
      description: "The project's shared agent instructions",
      project_ids: ["w2"],
      agent_ids: ["p3"],
    }),
    source({
      id: "fx-docs-memory",
      harnesses: ["claude"],
      kind: "memory",
      scope: "project",
      path: `${HOME}/.claude/projects/-workspace-docs-site/memory`,
      shape: "directory",
      load: "startup-candidate",
      description: "Claude's auto memory for this project",
      details: { claude: "MEMORY.md loads at start; topic files when needed" },
      project_ids: ["w2"],
      agent_ids: ["p3"],
      absent: true,
    }),
    source({
      id: "fx-reviewer-memory",
      harnesses: ["claude"],
      kind: "memory",
      scope: "agent",
      path: `${HOME}/.claude/agent-memory/reviewer`,
      shape: "directory",
      load: "on-demand",
      description: "The reviewer subagent's own memory",
      project_ids: ["w1"],
      agent_ids: ["p1"],
      refused: "The folder is a link that leaves its home",
    }),
  ];
  const files = new Map<string, FixtureFile>();
  const put = (sourceId: string, path: string, content: string, age: number) =>
    files.set(key(sourceId, path), {
      content,
      modified: now - age,
      revision: 1,
    });
  put(
    "fx-claude-user",
    "CLAUDE.md",
    "# Example preferences\n\n- Keep answers short.\n- Run the tests before saying done.\n- Ask before deleting anything.\n",
    3 * DAY,
  );
  put(
    "fx-codex-user",
    "AGENTS.md",
    "# Example Codex defaults\n\n- Prefer small commits.\n- Explain each change in one line.\n",
    12 * DAY,
  );
  put(
    "fx-codex-memories",
    "build-notes.md",
    "# Build notes\n\nThe example web app builds with `bun run build`.\nThe test lane takes about two minutes.\n",
    2 * 60 * 60 * 1000,
  );
  put(
    "fx-codex-memories",
    "old-hosting.md",
    "# Hosting (old)\n\nThe example app used to deploy from a cron job. That job is gone.\n",
    95 * DAY,
  );
  put(
    "fx-web-agents",
    "AGENTS.md",
    "# Example web app\n\nAgents working here:\n\n- Use synthetic data in tests.\n- Keep pages under one origin.\n",
    20 * 60 * 1000,
  );
  put(
    "fx-web-claude",
    "CLAUDE.md",
    "@AGENTS.md\n\n# Claude notes\n\nPrefer the design tokens over raw colours.\n",
    6 * DAY,
  );
  put("fx-web-rules", "empty-rule.md", "", 40 * DAY);
  put(
    "fx-web-rules",
    "style.md",
    "# Style\n\nTwo-space indent. No default exports.\n",
    9 * DAY,
  );
  put(
    "fx-web-memory",
    "MEMORY.md",
    "# Memory index\n\n- [Testing](testing.md): how tests run here\n- [Release](release.md): the release checklist\n",
    1 * DAY,
  );
  put(
    "fx-web-memory",
    "testing.md",
    "# Testing\n\nBrowser tests need a local Chrome. Unit tests sit beside the code.\n",
    4 * DAY,
  );
  put(
    "fx-web-memory",
    "release.md",
    "# Release\n\nTag only after the release branch is merged and verified.\n",
    61 * DAY,
  );
  put(
    "fx-opencode-user",
    "AGENTS.md",
    "Use synthetic examples in every project.\n",
    DAY,
  );
  put(
    "fx-opencode-project",
    "AGENTS.md",
    "OpenCode project: verify focused changes.\n",
    DAY,
  );
  return { sources, files, revision: 1 };
}

function lib() {
  library ??= seed(Date.now());
  return library;
}

/**
 * For tests and demos: change a file behind the page's back, so the next
 * save with the old revision conflicts.
 */
export function memoryFixtureTouch(
  sourceId: string,
  path: string,
  content: string,
) {
  const file = lib().files.get(key(sourceId, path));
  if (!file) return;
  file.content = content;
  file.modified = Date.now();
  file.revision += 1;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function catalog(target: MemoryTarget): MemoryCatalog {
  const now = Date.now();
  const { sources, files } = lib();
  const entries: MemoryEntry[] = [];
  const out: MemorySource[] = sources.map(
    ({ refused, modes, absent, ...rest }) => {
      const prefix = `${rest.id}\u0000`;
      const own = [...files.entries()].filter(([k]) => k.startsWith(prefix));
      for (const [k, file] of own) {
        const path = k.slice(prefix.length);
        const size = bytes(file.content);
        const age = now - file.modified;
        const loads: MemoryEntry["harness_loads"] = {};
        for (const harness of rest.harnesses) {
          const timing =
            rest.id === "fx-web-memory" && path !== "MEMORY.md"
              ? "on-demand"
              : rest.load;
          loads[harness] =
            size === 0
              ? { mode: "empty" }
              : (modes?.[path]?.[harness] ?? { mode: timing });
        }
        entries.push({
          id: `fx-${entries.length + 1}`,
          source_id: rest.id,
          path,
          size,
          modified_at: file.modified,
          age_ms: age,
          stale: age > MEMORY_LIMITS.stale_ms,
          state: "available",
          load: rest.load,
          harness_loads: loads,
        });
      }
      if (refused) return { ...rest, state: "refused", reason: refused };
      if (own.length === 0 && (rest.shape === "file" || absent))
        return {
          ...rest,
          state: "missing",
          reason:
            rest.shape === "file"
              ? "The file does not exist yet"
              : "The folder does not exist yet",
        };
      return { ...rest, state: "available" };
    },
  );
  const result: MemoryCatalog = {
    ...target,
    observed_at: now,
    projects: [
      { id: "w1", label: "web-app", path: "/workspace/web-app" },
      { id: "w2", label: "docs-site", path: "/workspace/docs-site" },
      { id: "w3", label: "opencode-app", path: "/workspace/opencode-app" },
      { id: "w4", label: "no-memory-app", path: "/workspace/no-memory-app" },
    ],
    agents: [
      {
        id: "p1",
        project_id: "w1",
        harness: "claude",
        path: "/workspace/web-app",
      },
      {
        id: "p2",
        project_id: "w1",
        harness: "codex",
        path: "/workspace/web-app",
      },
      {
        id: "p3",
        project_id: "w2",
        harness: "claude",
        path: "/workspace/docs-site",
      },
      {
        id: "p4",
        project_id: "w4",
        harness: "letta",
        path: "/workspace/no-memory-app",
      },
      {
        id: "p5",
        project_id: "w3",
        harness: "opencode",
        path: "/workspace/opencode-app",
      },
    ],
    sources: unsupportedOnly ? [] : out,
    entries: unsupportedOnly ? [] : entries,
    unsupported: [
      {
        agent_id: "p4",
        harness: "letta",
        reason: "World has no memory reader for this harness",
      },
    ],
    warnings: [
      "Candidates are not loaded-context receipts",
      "Imports such as @AGENTS.md are not expanded",
    ],
    truncated: false,
    limits: MEMORY_LIMITS,
  };
  return unsupportedOnly
    ? {
        ...result,
        projects: result.projects.filter((project) => project.id === "w4"),
        agents: result.agents.filter((agent) => agent.id === "p4"),
      }
    : result;
}

function owned(sourceId: string) {
  const found = lib().sources.find((s) => s.id === sourceId);
  if (!found) fail("not_found", "No such memory source");
  if (found.refused) fail("refused", found.refused);
  return found;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 120));

let client: MemoryClient | null = null;

/** The synthetic host's client: same shapes and failures as the service. */
export function memoryFixtureClient(): MemoryClient {
  client ??= {
    async list(target) {
      await pause();
      return catalog(target);
    },
    async search(target, query, filter = {}) {
      await pause();
      const needle = query.trim().toLowerCase();
      if (!needle) fail("invalid", "Search needs words");
      const list = catalog(target);
      const reads = new Set(
        list.sources
          .filter(
            (s) =>
              (!filter.agent_id || s.agent_ids.includes(filter.agent_id)) &&
              (!filter.workspace_id ||
                s.project_ids.includes(filter.workspace_id)),
          )
          .map((s) => s.id),
      );
      const matches: Awaited<ReturnType<MemoryClient["search"]>>["matches"] =
        [];
      let scanned = 0;
      for (const entry of list.entries) {
        if (!reads.has(entry.source_id)) continue;
        const file = lib().files.get(key(entry.source_id, entry.path));
        if (!file) continue;
        scanned += bytes(file.content);
        file.content.split("\n").forEach((line, index) => {
          if (line.toLowerCase().includes(needle))
            matches.push({ entry, line: index + 1, excerpt: line.trim() });
        });
      }
      return {
        ...target,
        query,
        matches,
        scanned_bytes: scanned,
        skipped: 0,
        truncated: false,
      };
    },
    async read(target, sourceId, path) {
      await pause();
      owned(sourceId);
      const file = lib().files.get(key(sourceId, path));
      if (!file) fail("not_found", "The file is gone");
      return {
        ...target,
        source_id: sourceId,
        path,
        content: file.content,
        revision: `r${file.revision}`,
        size: bytes(file.content),
        modified_at: file.modified,
      };
    },
    async create(target, sourceId, path, content) {
      await pause();
      const found = owned(sourceId);
      if (
        found.shape === "file" &&
        path !== found.path.slice(found.path.lastIndexOf("/") + 1)
      )
        fail("invalid", "A file source takes only its own name");
      const k = key(sourceId, path);
      if (lib().files.has(k)) fail("conflict", "A file with that name exists");
      found.absent = false;
      lib().files.set(k, { content, modified: Date.now(), revision: 1 });
      return {
        ...target,
        source_id: sourceId,
        path,
        status: "created",
        revision: "r1",
      };
    },
    async update(target, sourceId, path, revision, content) {
      await pause();
      owned(sourceId);
      const file = lib().files.get(key(sourceId, path));
      if (!file) fail("not_found", "The file is gone");
      if (`r${file.revision}` !== revision)
        fail("conflict", "The file changed since you opened it");
      if (content.includes(UNCERTAIN_MARK)) {
        // The testing switch's lost write: someone else edits the file and
        // the host stops answering, so World can't tell what happened.
        memoryFixtureTouch(
          sourceId,
          path,
          `${file.content.trimEnd()}\n\nEdited elsewhere meanwhile.\n`,
        );
        fail("uncertain", "The host stopped answering");
      }
      file.content = content;
      file.modified = Date.now();
      file.revision += 1;
      return {
        ...target,
        source_id: sourceId,
        path,
        status: "updated",
        revision: `r${file.revision}`,
      };
    },
    async remove(target, sourceId, path, revision) {
      await pause();
      owned(sourceId);
      const k = key(sourceId, path);
      const file = lib().files.get(k);
      if (!file) fail("not_found", "The file is gone");
      if (`r${file.revision}` !== revision)
        fail("conflict", "The file changed since you opened it");
      lib().files.delete(k);
      return {
        ...target,
        source_id: sourceId,
        path,
        status: "deleted",
        revision: null,
      };
    },
  };
  return client;
}
