import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_LIMITS,
  type MemoryCatalog,
  type MemoryMutation,
  type MemoryRead,
  type MemorySearch,
} from "../../../shared/memory";
import { runProcessWithInputTimeout } from "../workspace/process";
import { createMemoryHost, type MemoryHost } from "./host";
import { MemoryService } from "./service";

const cleanup: string[] = [];
afterEach(() => {
  for (const root of cleanup.splice(0))
    rmSync(root, { recursive: true, force: true });
});

export function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "world-memory-test-")));
  cleanup.push(root);
  const home = join(root, "home"),
    repo = join(root, "project");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(home);
  const write = (path: string, content: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  };
  const host = createMemoryHost({
    sshHost: () => undefined,
    run: (argv, input, timeout) =>
      runProcessWithInputTimeout(
        [
          "env",
          `HOME=${home}`,
          `CODEX_HOME=${home}/.codex`,
          `CLAUDE_CONFIG_DIR=${home}/.claude`,
          `PI_CODING_AGENT_DIR=${home}/.pi/agent`,
          "CLAUDE_CODE_PROJECT_DIR_NAME=",
          ...argv,
        ],
        input,
        timeout,
      ),
  });
  let current = true;
  const operations = {
    listWorkspaces: async () => ({
      workspaces: [
        { workspace_id: "w1", label: "Example", cwd: repo },
        { workspace_id: "w2", cwd: repo },
      ],
    }),
    listTerminals: async () => ({
      panes: [
        { pane_id: "p1", workspace_id: "w1", cwd: repo, agent: "claude" },
        { pane_id: "p2", workspace_id: "w2", cwd: repo, agent: "claude" },
        { pane_id: "p3", workspace_id: "w1", cwd: repo, agent: "codex" },
        {
          pane_id: "p4",
          workspace_id: "w1",
          cwd: repo,
          agent: "unknown-harness",
        },
      ],
    }),
  };
  const target = { connection_id: "box", connection_generation: 3 };
  const service = new MemoryService({
    lease: (id) =>
      id === "box"
        ? {
            generation: 3,
            isCurrent: () => current,
            runtime: { operations, memoryHost: host },
          }
        : null,
    now: () => Date.now(),
  });
  const list = () => service.call("list", target) as Promise<MemoryCatalog>;
  return {
    root,
    home,
    repo,
    write,
    host,
    operations,
    target,
    service,
    list,
    retire: () => {
      current = false;
    },
  };
}

describe("memory on its real owning filesystem", () => {
  test("discovers instructions, project memory, Codex v1/v2, sharing, age and unsupported harnesses", async () => {
    const f = fixture();
    f.write(join(f.repo, "CLAUDE.md"), "Project rules\n");
    f.write(join(f.repo, "AGENTS.md"), "Shared instructions\n");
    f.write(join(f.repo, "AGENTS.override.md"), "Codex override\n");
    f.write(
      join(f.home, ".codex/memories/memory_summary.md"),
      "Recall example\n",
    );
    f.write(
      join(f.home, ".codex/memories_v2/project/note.md"),
      "Second version\n",
    );
    const key = f.repo.replace(/[^a-zA-Z0-9]/g, "-");
    const memory = join(f.home, ".claude/projects", key, "memory");
    f.write(join(memory, "MEMORY.md"), "# Index\n");
    f.write(join(memory, "topic.md"), "A past decision\n");
    utimesSync(join(memory, "topic.md"), new Date(0), new Date(0));
    const result = await f.list();
    const source = result.sources.find((s) => s.path === memory)!;
    expect(source).toMatchObject({
      state: "available",
      project_ids: ["w1", "w2"],
      agent_ids: ["p1", "p2"],
    });
    expect(
      result.entries.find(
        (e) => e.source_id === source.id && e.path === "MEMORY.md",
      )?.load,
    ).toBe("startup-candidate");
    expect(
      result.entries.find(
        (e) => e.source_id === source.id && e.path === "topic.md",
      ),
    ).toMatchObject({ stale: true, size: 16, load: "on-demand" });
    expect(result.entries.some((e) => e.path === "memory_summary.md")).toBe(
      true,
    );
    expect(result.entries.some((e) => e.path === "project/note.md")).toBe(true);
    expect(result.unsupported).toContainEqual({
      agent_id: "p4",
      harness: null,
      reason: "No memory adapter for this observed harness",
    });
    const agents = result.sources.find(
      (s) => s.path === join(f.repo, "AGENTS.md"),
    )!;
    expect(agents.harnesses.sort()).toEqual(["claude", "codex", "pi"]);
    expect(
      result.entries.find((e) => e.source_id === agents.id)?.harness_loads,
    ).toMatchObject({
      codex: { mode: "shadowed" },
      claude: { mode: "shadowed" },
      pi: { mode: "startup-candidate" },
    });
    expect(JSON.stringify(result)).not.toContain("A past decision");
    const filtered = (await f.service.call("list", {
      ...f.target,
      agent_id: "p1",
    })) as MemoryCatalog;
    expect(filtered.sources.find((s) => s.id === source.id)?.agent_ids).toEqual(
      ["p1", "p2"],
    );
  });

  test("explicit create/read/search/update/delete round trip with stale revision refusal and permission preservation", async () => {
    const f = fixture();
    const source = (await f.list()).sources.find(
      (s) => s.path === join(f.home, ".codex/memories"),
    )!;
    const params = {
      ...f.target,
      source_id: source.id,
      path: "topic.md",
      user_action: true,
    };
    await expect(
      f.service.call("create", {
        ...params,
        user_action: false,
        content: "No",
      }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(existsSync(source.path)).toBe(false);
    const created = (await f.service.call("create", {
      ...params,
      content: "First memory\nSecond line\n",
    })) as MemoryMutation;
    expect(created.status).toBe("created");
    expect(statSync(join(source.path, "topic.md")).mode & 0o777).toBe(0o600);
    await expect(
      f.service.call("create", { ...params, content: "clobber" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const read = (await f.service.call("read", params)) as MemoryRead;
    expect(read.content).toBe("First memory\nSecond line\n");
    expect(read.revision).toBe(created.revision!);
    const found = (await f.service.call("search", {
      ...f.target,
      query: "MEMORY",
    })) as MemorySearch;
    expect(found.matches).toContainEqual(
      expect.objectContaining({ line: 1, excerpt: "First memory" }),
    );
    chmodSync(join(source.path, "topic.md"), 0o640);
    const before = (await f.service.call("read", params)) as MemoryRead;
    const updated = (await f.service.call("update", {
      ...params,
      revision: before.revision,
      content: "Updated\n",
    })) as MemoryMutation;
    expect(updated.status).toBe("updated");
    expect(statSync(join(source.path, "topic.md")).mode & 0o777).toBe(0o640);
    await expect(
      f.service.call("delete", {
        ...params,
        confirmed: true,
        revision: before.revision,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.call("delete", { ...params, revision: updated.revision }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(
      (
        (await f.service.call("delete", {
          ...params,
          confirmed: true,
          revision: updated.revision,
        })) as MemoryMutation
      ).status,
    ).toBe("deleted");
    expect(existsSync(join(source.path, "topic.md"))).toBe(false);
  });

  test("refuses traversal, symlinks, hardlinks, binary, oversized and foreign source paths", async () => {
    const f = fixture();
    const source = (await f.list()).sources.find(
      (s) => s.path === join(f.repo, "AGENTS.md"),
    )!;
    const params = { ...f.target, source_id: source.id };
    await expect(
      f.service.call("read", { ...params, path: "../secret.md" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      f.service.call("read", { ...params, path: "OTHER.md" }),
    ).rejects.toMatchObject({ code: "refused" });
    await expect(
      f.service.call("read", {
        ...params,
        source_id: "foreign",
        path: "AGENTS.md",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const outside = join(f.root, "outside.md");
    f.write(outside, "Private");
    const actual = join(f.repo, "AGENTS.md");
    symlinkSync(outside, actual);
    await expect(
      f.service.call("read", { ...params, path: "AGENTS.md" }),
    ).rejects.toMatchObject({ code: "refused" });
    rmSync(actual);
    linkSync(outside, actual);
    await expect(
      f.service.call("read", { ...params, path: "AGENTS.md" }),
    ).rejects.toMatchObject({ code: "refused" });
    rmSync(actual);
    f.write(actual, "binary\0data");
    await expect(
      f.service.call("read", { ...params, path: "AGENTS.md" }),
    ).rejects.toMatchObject({ code: "refused" });
    f.write(actual, "x".repeat(MEMORY_LIMITS.file_bytes + 1));
    await expect(
      f.service.call("read", { ...params, path: "AGENTS.md" }),
    ).rejects.toMatchObject({ code: "too_large" });
    const listed = await f.list();
    expect(listed.entries.find((e) => e.source_id === source.id)?.reason).toBe(
      "too_large",
    );
    const dir = listed.sources.find(
      (s) => s.path === join(f.home, ".codex/memories"),
    )!;
    mkdirSync(join(f.home, ".codex"), { recursive: true });
    symlinkSync(f.root, dir.path);
    await expect(
      f.service.call("create", {
        ...f.target,
        source_id: dir.id,
        path: "outside.md",
        content: "No",
        user_action: true,
      }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(readFileSync(outside, "utf8")).toBe("Private");
  });

  test("unknown, disconnected and stale generations do not touch another host", async () => {
    const f = fixture();
    await expect(f.service.call("list", {})).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      f.service.call("list", { ...f.target, connection_id: "other" }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      f.service.call("list", { ...f.target, connection_generation: 2 }),
    ).rejects.toMatchObject({ code: "unavailable" });
    f.retire();
    await expect(f.list()).rejects.toMatchObject({ code: "unavailable" });
  });

  test("retirement during read refuses; retirement after dispatch returns unknown outcome", async () => {
    const f = fixture();
    const source = (await f.list()).sources.find(
      (s) => s.path === join(f.repo, "AGENTS.md"),
    )!;
    const original = f.host.execute.bind(f.host);
    f.host.execute = async <T>(
      request: Record<string, unknown>,
    ): Promise<T> => {
      const reply = await original<T>(request);
      if (request.action === "create") f.retire();
      return reply;
    };
    await expect(
      f.service.call("create", {
        ...f.target,
        source_id: source.id,
        path: "AGENTS.md",
        content: "Saved",
        user_action: true,
      }),
    ).rejects.toMatchObject({ code: "uncertain" });
    expect(readFileSync(source.path, "utf8")).toBe("Saved");
    const g = fixture();
    let alive = true;
    const readHost: MemoryHost = {
      execute: async <T>(request: Record<string, unknown>) => {
        const result = await g.host.execute<T>(request);
        alive = false;
        return result;
      },
    };
    const service = new MemoryService({
      lease: () => ({
        generation: 3,
        isCurrent: () => alive,
        runtime: { operations: g.operations, memoryHost: readHost },
      }),
    });
    await expect(service.call("list", g.target)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  test("caps entry counts, recursion, literal search and response sizes", async () => {
    const f = fixture();
    const folder = join(f.home, ".codex/memories");
    for (let i = 0; i < MEMORY_LIMITS.entries + 5; i++)
      f.write(join(folder, `${i}.md`), "needle\n");
    const catalog = await f.list();
    expect(catalog.truncated).toBe(true);
    expect(catalog.entries.length).toBeLessThanOrEqual(MEMORY_LIMITS.entries);
    const result = (await f.service.call("search", {
      ...f.target,
      query: "needle",
    })) as MemorySearch;
    expect(result.matches).toHaveLength(MEMORY_LIMITS.search_results);
    expect(result.truncated).toBe(true);
    await expect(
      f.service.call("search", { ...f.target, query: "x".repeat(201) }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  test("depth, search bytes and UTF-8 refusals are bounded and reported", async () => {
    const f = fixture();
    const folder = join(f.home, ".codex/memories");
    f.write(join(folder, "a/b/c/d/e/hidden.md"), "Deep memory\n");
    f.write(join(folder, "binary.md"), "Bad\0text");
    for (let i = 0; i < 9; i++)
      f.write(join(folder, `${i}.md`), "x".repeat(MEMORY_LIMITS.file_bytes));
    const catalog = await f.list();
    expect(catalog.truncated).toBe(true);
    expect(catalog.entries.some((e) => e.path.endsWith("hidden.md"))).toBe(
      false,
    );
    const result = (await f.service.call("search", {
      ...f.target,
      query: "absent",
    })) as MemorySearch;
    expect(result.truncated).toBe(true);
    expect(result.scanned_bytes).toBeLessThanOrEqual(
      MEMORY_LIMITS.search_bytes,
    );
    const source = catalog.sources.find((s) => s.path === folder)!;
    writeFileSync(join(folder, "invalid.md"), Buffer.from([0xff]));
    await expect(
      f.service.call("read", {
        ...f.target,
        source_id: source.id,
        path: "invalid.md",
      }),
    ).rejects.toMatchObject({ code: "refused" });
  });

  test("user-configured Claude memory and worktrees use the same project source", async () => {
    const f = fixture();
    const main = join(f.root, "main");
    mkdirSync(join(main, ".git/worktrees/topic"), { recursive: true });
    f.write(join(f.repo, ".git/placeholder"), "");
    rmSync(join(f.repo, ".git"), { recursive: true });
    f.write(join(f.repo, ".git"), `gitdir: ${main}/.git/worktrees/topic\n`);
    f.write(join(main, ".git/worktrees/topic/commondir"), "../..\n");
    const key = main.replace(/[^a-zA-Z0-9]/g, "-");
    expect(
      (await f.list()).sources.some(
        (s) => s.path === join(f.home, ".claude/projects", key, "memory"),
      ),
    ).toBe(true);
    const custom = join(f.home, "custom-memory");
    f.write(
      join(f.home, ".claude/settings.json"),
      JSON.stringify({ autoMemoryDirectory: custom }),
    );
    f.write(join(custom, "MEMORY.md"), "Index");
    expect((await f.list()).sources.find((s) => s.path === custom)?.state).toBe(
      "available",
    );
  });
});
