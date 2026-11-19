import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore, emptyBoardDocument } from "./board-store";
import {
  createBoardElementService,
  type BoardElementFiles,
} from "./board-element-service";
import { readLocalFile, listLocalFiles } from "../workspace/local-files";
import { BOARD_ELEMENT_LIMITS } from "../../../shared/boardElements";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const source = {
  connection_id: "studio",
  workspace_id: "project-a",
  path: "MEMORY.md",
};
const input = (id: string, kind = "memory", data: unknown = source) => ({
  id,
  kind,
  title: "Synthetic reference",
  x: 10,
  y: 20,
  source: data,
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "board-elements-"));
  roots.push(root);
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await writeFile(
    join(projectRoot, "MEMORY.md"),
    "Remember the release criteria.",
  );
  const board = new BoardStore(join(root, "board.json"));
  const published: number[] = [];
  let current = true;
  const files: BoardElementFiles = {
    readWorkspaceFile: async (params) => {
      expect(params.workspace_id).toBe("project-a");
      return readLocalFile(projectRoot, String(params.path));
    },
    listWorkspaceFiles: (params) =>
      listLocalFiles(projectRoot, String(params.path), true),
  };
  const service = createBoardElementService({
    board: () => board,
    publish: (rev) => published.push(rev),
    project: (ref, generation) => {
      expect(ref.connection_id).toBe("studio");
      expect(generation).toBe(7);
      return { files, isCurrent: () => current };
    },
  });
  return {
    root,
    projectRoot,
    board,
    service,
    files,
    published,
    retire: () => {
      current = false;
    },
  };
}

test("real memory files, saved logs after pane removal, inline docs and inert PR/issue links", async () => {
  const f = await fixture();
  await f.service.call("put", { element: input("memory") });
  expect(await f.service.call("read", { id: "memory" })).toEqual({
    status: "refused",
    reason: "generation_required",
  });
  const read = await f.service.call("read", {
    id: "memory",
    connection_generation: 7,
  });
  expect(read).toMatchObject({
    status: "ready",
    target: { ...source, connection_generation: 7 },
    content: { text: "Remember the release criteria.", truncated: false },
  });
  expect(JSON.stringify(read)).not.toContain(f.root);
  await writeFile(
    join(f.projectRoot, "past-agent.jsonl"),
    '{"role":"assistant","text":"Shipped"}\n',
  );
  await f.service.call("put", {
    element: input("log", "log", {
      ...source,
      path: "past-agent.jsonl",
      agent_ref: "session-example",
    }),
  });
  expect(
    await f.service.call("read", { id: "log", connection_generation: 7 }),
  ).toMatchObject({
    status: "ready",
    content: { text: '{"role":"assistant","text":"Shipped"}\n' },
  });
  await f.service.call("put", {
    element: input("doc", "document", { text: "Planning draft" }),
  });
  expect(await f.service.call("read", { id: "doc" })).toMatchObject({
    status: "ready",
    content: { text: "Planning draft" },
  });
  for (const [id, url, link_kind] of [
    ["pr", "https://github.com/example/project/pull/42", "pull_request"],
    ["issue", "https://github.com/example/project/issues/7", "issue"],
    ["url", "https://example.com/", "url"],
  ]) {
    await f.service.call("put", { element: input(id!, "link", { url }) });
    expect(await f.service.call("read", { id })).toMatchObject({
      status: "ready",
      content: { type: "link", link_kind, fetch: false },
    });
  }
  expect(f.published).toEqual([1, 2, 3, 4, 5, 6]);
});

test("bounded directory memory selection, binary/missing refusal and symlink confinement", async () => {
  const f = await fixture();
  await mkdir(join(f.projectRoot, "memory"));
  for (let i = 0; i < 34; i++)
    await writeFile(join(f.projectRoot, "memory", `m-${i}.md`), "Saved memory");
  await f.service.call("put", {
    element: input("memory", "memory", { ...source, path: "memory" }),
  });
  const listing = (await f.service.call("read", {
    id: "memory",
    connection_generation: 7,
  })) as { content: { entries: unknown[]; truncated: boolean } };
  expect(listing.content.entries).toHaveLength(32);
  expect(listing.content.truncated).toBe(true);
  expect(
    await f.service.call("read", {
      id: "memory",
      connection_generation: 7,
      path: "m-0.md",
    }),
  ).toMatchObject({ status: "ready", content: { text: "Saved memory" } });
  expect(
    await f.service.call("read", {
      id: "memory",
      connection_generation: 7,
      path: "../MEMORY.md",
    }),
  ).toMatchObject({ status: "unavailable" });
  await writeFile(join(f.root, "outside.md"), "Outside project");
  await symlink(
    join(f.root, "outside.md"),
    join(f.projectRoot, "memory", "escape.md"),
  );
  expect(
    await f.service.call("read", {
      id: "memory",
      connection_generation: 7,
      path: "escape.md",
    }),
  ).toMatchObject({ status: "unavailable" });
  await writeFile(join(f.projectRoot, "binary.bin"), Buffer.from([0, 1, 2]));
  await f.service.call("put", {
    element: input("binary", "document", { ...source, path: "binary.bin" }),
  });
  expect(
    await f.service.call("read", { id: "binary", connection_generation: 7 }),
  ).toMatchObject({ status: "unavailable", reason: "not_text" });
  expect(
    await f.service.call("read", {
      id: "memory",
      connection_generation: 7,
      path: "absent.md",
    }),
  ).toMatchObject({ status: "unavailable", reason: "source_unavailable" });
});

test("read caps UTF-8 bytes, concurrent requests and retires in-flight source results", async () => {
  const f = await fixture();
  await writeFile(join(f.projectRoot, "MEMORY.md"), "界".repeat(30_000));
  await f.service.call("put", { element: input("memory") });
  const result = (await f.service.call("read", {
    id: "memory",
    connection_generation: 7,
  })) as { content: { text: string; truncated: boolean } };
  expect(Buffer.byteLength(result.content.text)).toBeLessThanOrEqual(
    BOARD_ELEMENT_LIMITS.readBytes,
  );
  expect(result.content.text).not.toContain("�");
  expect(result.content.truncated).toBe(true);
  const release = Promise.withResolvers<void>();
  const readFile = f.files.readWorkspaceFile;
  f.files.readWorkspaceFile = async (params) => {
    await release.promise;
    return readFile(params);
  };
  const pending = Array.from({ length: 8 }, () =>
    f.service.call("read", { id: "memory", connection_generation: 7 }),
  );
  expect(
    await f.service.call("read", { id: "memory", connection_generation: 7 }),
  ).toEqual({ status: "refused", reason: "busy" });
  f.retire();
  release.resolve();
  for (const outcome of await Promise.all(pending))
    expect(outcome).toMatchObject({ status: "refused" });
});

test("source results cannot publish after element edit/deletion or request retirement", async () => {
  for (const change of ["edit", "delete", "request"]) {
    const f = await fixture();
    await f.service.call("put", { element: input("memory") });
    const read = f.files.readWorkspaceFile;
    let current = true;
    f.files.readWorkspaceFile = async (params) => {
      if (change === "edit")
        await f.service.call("put", {
          element: input("memory", "memory", { ...source, path: "other.md" }),
          rev: 1,
        });
      if (change === "delete")
        await f.service.call("delete", { id: "memory", rev: 1 });
      if (change === "request") current = false;
      return read(params);
    };
    expect(
      await f.service.call(
        "read",
        { id: "memory", connection_generation: 7 },
        () => current,
      ),
    ).toMatchObject({ status: "refused" });
  }
});

test("element count, duplicate identities and invalid writes leave the prior Board intact", async () => {
  const board = new BoardStore({ read: emptyBoardDocument, commit: () => {} });
  const service = createBoardElementService({
    board: () => board,
    publish: () => {},
    project: () => {
      throw new Error("unused");
    },
  });
  for (let i = 0; i < 500; i++)
    await service.call("put", {
      element: input(`e-${i}`, "document", { text: "Draft" }),
    });
  const before = board.get();
  await expect(
    service.call("put", {
      element: input("overflow", "document", { text: "Draft" }),
    }),
  ).rejects.toThrow("too many");
  expect(board.get()).toEqual(before);
  await expect(
    service.call("put", {
      element: input("e-0", "document", { text: "stale" }),
    }),
  ).resolves.toMatchObject({ status: "conflict" });
  expect(() =>
    board.patch([
      {
        op: "note.put",
        note: { id: "e-0", text: "Collision", color: "yellow", x: 0, y: 0 },
      },
    ]),
  ).toThrow("duplicate");
  expect(board.get()).toEqual(before);
});
