/** Manual acceptance against independently observed vendor-loader results; starts no server. */
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  memoryHarness,
  type MemoryCatalog,
  type MemoryRead,
} from "../shared/memory";
import { createMemoryHost } from "../server/src/memory/host";
import { MemoryService } from "../server/src/memory/service";
import { runProcessWithInputTimeout } from "../server/src/workspace/process";
import {
  agentLoad,
  libraryWings,
  readerRows,
} from "../web/src/world/memory/memoryModel";

export type InstallObservation = {
  harness: string;
  version: string;
  home: string;
  project: string;
  cwd?: string;
  /** Maker-documented files present at observation, including competing alternatives. */
  files: string[];
  /** Exact startup files independently reported/read; omit for inventory-only probes. */
  loaded?: string[];
};

const same = (a: string[], b: string[], label: string) => {
  const left = [...new Set(a)].sort(),
    right = [...new Set(b)].sort();
  if (JSON.stringify(left) !== JSON.stringify(right))
    throw new Error(
      `${label}: missing ${
        right
          .filter((p) => !left.includes(p))
          .map((p) => p.split("/").pop())
          .join(", ") || "none"
      }; unexpected ${
        left
          .filter((p) => !right.includes(p))
          .map((p) => p.split("/").pop())
          .join(", ") || "none"
      }`,
    );
};

/** Calls the production list/read worker and the Library's real projection on those files. */
export async function auditMemoryInstall(observation: InstallObservation) {
  const harness = memoryHarness(observation.harness);
  if (
    !harness ||
    !observation.version ||
    !isAbsolute(observation.home) ||
    !isAbsolute(observation.project)
  )
    throw new Error(
      "Expected a supported harness, version and absolute disposable home/project",
    );
  const inside = (value: string) =>
    [observation.home, observation.project].some((root) => {
      const child = relative(root, value);
      return child !== ".." && !child.startsWith("../") && !isAbsolute(child);
    });
  if (
    [
      ...observation.files,
      ...(observation.loaded ?? []),
      ...(observation.cwd ? [observation.cwd] : []),
    ].some((p) => !isAbsolute(p) || !inside(p))
  )
    throw new Error(
      "Observation files must belong to the disposable home/project",
    );
  const home = observation.home;
  const filesystem = createMemoryHost({
    sshHost: () => undefined,
    run: (argv, input, timeout) =>
      runProcessWithInputTimeout(
        [
          "env",
          "-i",
          `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`,
          `HOME=${home}`,
          `XDG_CONFIG_HOME=${home}/.config`,
          `CODEX_HOME=${home}/.codex`,
          `CLAUDE_CONFIG_DIR=${home}/.claude`,
          `PI_CODING_AGENT_DIR=${home}/.pi/agent`,
          `COPILOT_HOME=${home}/.copilot`,
          `HERMES_HOME=${home}/.hermes`,
          `QWEN_HOME=${home}/.qwen`,
          `KIMI_CODE_HOME=${home}/.kimi-code`,
          ...argv,
        ],
        input,
        timeout,
      ),
  });
  const service = new MemoryService({
    lease: (id) =>
      id === "install-audit"
        ? {
            generation: 1,
            isCurrent: () => true,
            runtime: {
              operations: {
                listWorkspaces: async () => ({
                  workspaces: [
                    { workspace_id: "project", cwd: observation.project },
                  ],
                }),
                listTerminals: async () => ({
                  panes: [
                    {
                      pane_id: "agent",
                      workspace_id: "project",
                      cwd: observation.cwd ?? observation.project,
                      agent: harness,
                    },
                  ],
                }),
              },
              memoryHost: {
                execute<T>(request: Record<string, unknown>) {
                  // Do not inspect real ancestor/system files above the disposable checkout.
                  const sources = request.sources as
                    | Array<{ path: string }>
                    | undefined;
                  return filesystem.execute<T>({
                    ...request,
                    ...(sources
                      ? { sources: sources.filter((s) => inside(s.path)) }
                      : {}),
                  });
                },
              },
            },
          }
        : null,
  });
  const target = { connection_id: "install-audit", connection_generation: 1 };
  const catalog = (await service.call("list", target)) as MemoryCatalog;
  if (
    catalog.truncated ||
    catalog.unsupported.length ||
    catalog.entries.some((e) => e.state !== "available")
  )
    throw new Error("Incomplete or refused memory catalog");
  const fullPath = (entry: { source_id: string; path: string }) => {
    const source = catalog.sources.find((s) => s.id === entry.source_id)!;
    return source.shape === "file"
      ? source.path
      : join(source.path, entry.path);
  };
  same(catalog.entries.map(fullPath), observation.files, "memory list");
  const reader = { kind: "agent" as const, id: "agent" };
  const books = libraryWings(catalog, reader).flatMap((w) =>
    w.shelves.flatMap((s) => s.entries),
  );
  same(books.map(fullPath), observation.files, "Library shelves");
  if (readerRows(catalog).flatMap((r) => r.agents ?? []).length !== 1)
    throw new Error("Library omitted its supported reader");
  const load = agentLoad(catalog, "agent")!;
  if (observation.loaded)
    same(
      load.startup.map(fullPath),
      observation.loaded,
      "Library startup versus vendor loader",
    );
  for (const entry of books) {
    const actual = (await service.call("read", {
      ...target,
      source_id: entry.source_id,
      path: entry.path,
    })) as MemoryRead;
    if (actual.content !== (await readFile(fullPath(entry), "utf8")))
      throw new Error("Library read differs from its owning file");
  }
  return {
    harness,
    version: observation.version,
    files: books.length,
    startup: load.startup.length,
    on_demand: load.onDemand.length,
    skipped: load.skipped.length,
    startup_checked: observation.loaded !== undefined,
  };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Usage: bun scripts/memory-install-audit.ts observations.json",
    );
  const observations: InstallObservation[] = JSON.parse(
    await readFile(file, "utf8"),
  );
  for (const observation of observations)
    console.log(JSON.stringify(await auditMemoryInstall(observation)));
}
