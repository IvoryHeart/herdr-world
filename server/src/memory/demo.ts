import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_LIMITS,
  MemoryError,
  type MemoryCatalog,
  type MemoryMutation,
  type MemoryRead,
  type MemorySearch,
} from "../../../shared/memory";
import { runProcessWithInputTimeout } from "../workspace/process";
import { createMemoryHost, type MemoryHost } from "./host";
import { MemoryService } from "./service";

/** Explicit testing-only CLI fixture; never connects to World or a user's harness. */
export async function memoryDemo() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "world-memory-demo-")),
  );
  try {
    const home = join(root, "home"),
      project = join(root, "example"),
      opencode = join(root, "opencode-app"),
      unsupported = join(root, "no-memory-app");
    const folder = join(home, ".codex/memories");
    await mkdir(folder, { recursive: true });
    await mkdir(join(project, ".git"), { recursive: true });
    await writeFile(join(project, "AGENTS.md"), "Use synthetic data.\n");
    for (const dir of [opencode, unsupported])
      await mkdir(join(dir, ".git"), { recursive: true });
    await mkdir(join(home, ".config/opencode"), { recursive: true });
    await writeFile(
      join(opencode, "AGENTS.md"),
      "OpenCode project instructions.\n",
    );
    await writeFile(
      join(home, ".config/opencode/AGENTS.md"),
      "OpenCode user instructions.\n",
    );
    await writeFile(
      join(unsupported, "AGENTS.md"),
      "A file alone does not prove a supported reader.\n",
    );
    await writeFile(join(folder, "old.md"), "A synthetic decision to find.\n");
    await utimes(join(folder, "old.md"), new Date(0), new Date(0));
    const filesystem = createMemoryHost({
      sshHost: () => undefined,
      run: (argv, input, timeout) =>
        runProcessWithInputTimeout(
          [
            "env",
            `HOME=${home}`,
            `CODEX_HOME=${home}/.codex`,
            `CLAUDE_CONFIG_DIR=${home}/.claude`,
            `PI_CODING_AGENT_DIR=${home}/.pi/agent`,
            `XDG_CONFIG_HOME=${home}/.config`,
            `COPILOT_HOME=${home}/.copilot`,
            `HERMES_HOME=${home}/.hermes`,
            `QWEN_HOME=${home}/.qwen`,
            `KIMI_CODE_HOME=${home}/.kimi-code`,
            "CLAUDE_CODE_PROJECT_DIR_NAME=",
            ...argv,
          ],
          input,
          timeout,
        ),
    });
    // Production adapters inspect ancestor instructions as harnesses do. The
    // demo must not inspect a real /AGENTS.md or /tmp/CLAUDE.md above its fixture.
    const inside = (value: string) => value.startsWith(`${root}/`);
    const host: MemoryHost = {
      execute<T>(request: Record<string, unknown>) {
        const sources = request.sources as
          | Array<{ id: string; path: string }>
          | undefined;
        const source = request.source as { path: string } | undefined;
        if (source && !inside(source.path))
          throw new MemoryError(
            "refused",
            "Fixture source is outside the temporary directory",
          );
        return filesystem.execute<T>({
          ...request,
          ...(sources
            ? { sources: sources.filter((source) => inside(source.path)) }
            : {}),
        });
      },
    };
    const service = new MemoryService({
      lease: (id) =>
        id === "memory-fixture"
          ? {
              generation: 1,
              isCurrent: () => true,
              runtime: {
                memoryHost: host,
                operations: {
                  listWorkspaces: async () => ({
                    workspaces: [
                      { workspace_id: "example", cwd: project },
                      { workspace_id: "opencode", cwd: opencode },
                      { workspace_id: "unsupported", cwd: unsupported },
                    ],
                  }),
                  listTerminals: async () => ({
                    panes: [
                      ...[1, 2].map((id) => ({
                        pane_id: `p${id}`,
                        workspace_id: "example",
                        cwd: project,
                        agent: "codex",
                      })),
                      {
                        pane_id: "p3",
                        workspace_id: "opencode",
                        cwd: opencode,
                        agent: "opencode",
                      },
                      {
                        pane_id: "p4",
                        workspace_id: "unsupported",
                        cwd: unsupported,
                        agent: "letta",
                      },
                    ],
                  }),
                },
              },
            }
          : null,
    });
    const target = {
      connection_id: "memory-fixture",
      connection_generation: 1,
    };
    const catalog = (await service.call("list", target)) as MemoryCatalog;
    const source = catalog.sources.find((s) => s.path === folder)!;
    const params = {
      ...target,
      source_id: source.id,
      path: "managed.md",
      user_action: true,
    };
    const created = (await service.call("create", {
      ...params,
      content: "Synthetic memory to find.\n",
    })) as MemoryMutation;
    const read = (await service.call("read", params)) as MemoryRead;
    const search = (await service.call("search", {
      ...target,
      query: "find",
    })) as MemorySearch;
    const updated = (await service.call("update", {
      ...params,
      content: "Updated memory.\n",
      revision: read.revision,
    })) as MemoryMutation;
    const refusal = async (work: () => Promise<unknown>) => {
      try {
        await work();
        return "unexpected-success";
      } catch (error) {
        if (error instanceof MemoryError) return error.code;
        throw error;
      }
    };
    const conflict = await refusal(() =>
      service.call("delete", {
        ...params,
        revision: read.revision,
        confirmed: true,
      }),
    );
    const confirmation = await refusal(() =>
      service.call("delete", { ...params, revision: updated.revision }),
    );
    const deleted = (await service.call("delete", {
      ...params,
      revision: updated.revision,
      confirmed: true,
    })) as MemoryMutation;
    await writeFile(
      join(folder, "too-large.md"),
      "x".repeat(MEMORY_LIMITS.file_bytes + 1),
    );
    // Enough entries for the count limit without needing real agents or time to pass.
    for (let i = 0; i <= MEMORY_LIMITS.entries; i++)
      await writeFile(join(folder, `fixture-${i}.md`), "Synthetic\n");
    const bounded = (await service.call("list", target)) as MemoryCatalog;
    return {
      fixture: true,
      opencode_sources: catalog.sources
        .filter(
          (s) => s.harnesses.includes("opencode") && s.state === "available",
        )
        .map((s) => ({
          name: s.path.split("/").pop(),
          scope: s.scope,
          kind: s.kind,
          load: s.load,
          description: s.details.opencode,
        })),
      unsupported_sources: catalog.sources.filter((s) =>
        s.project_ids.includes("unsupported"),
      ).length,
      shared_agents: source.agent_ids,
      stale: catalog.entries.some((e) => e.path === "old.md" && e.stale),
      search_matches: search.matches.length,
      created: created.status,
      read: read.content,
      updated: updated.status,
      stale_revision: conflict,
      unconfirmed_delete: confirmation,
      deleted: deleted.status,
      truncated: bounded.truncated,
      entry_count: bounded.entries.length,
      entry_limit: MEMORY_LIMITS.entries,
      cleaned_up: true,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
