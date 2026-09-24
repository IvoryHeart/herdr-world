import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deleteLocalFile,
  downloadLocalFile,
  listLocalFiles,
  readLocalFile,
  resolveLocalFilePaths,
  uploadLocalFile,
} from "./local-files";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "herdr-gui-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("local workspace file operations", () => {
  test("lists files with hidden filtering and directory-first sorting", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "README.md"), "hello");
      await writeFile(join(root, ".env"), "secret");

      const hiddenOff = await listLocalFiles(root, "", false);
      expect(hiddenOff.entries.map((entry) => entry.name)).toEqual([
        "src",
        "README.md",
      ]);

      const hiddenOn = await listLocalFiles(root, "", true);
      expect(hiddenOn.entries.some((entry) => entry.name === ".env")).toBe(
        true,
      );
    });
  });

  test("reads relative and absolute file previews", async () => {
    await withTempDir(async (root) => {
      const outsideName = `outside-${Date.now()}.txt`;
      const outside = join(root, "..", outsideName);
      await writeFile(join(root, "README.md"), "hello");
      await writeFile(outside, "outside");
      try {
        expect(await readLocalFile(root, "README.md")).toMatchObject({
          path: "README.md",
          text: "hello",
          binary: false,
        });
        const absolute = await readLocalFile(root, outside);
        expect(absolute).toMatchObject({
          text: "outside",
          binary: false,
        });
        expect(absolute.path.endsWith(`/${outsideName}`)).toBe(true);
      } finally {
        await rm(outside, { force: true });
      }
    });
  });

  test("reads directory previews instead of rejecting them", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src", "app"), { recursive: true });
      const relative = await readLocalFile(root, "src/app");
      expect(relative).toMatchObject({
        type: "directory",
        path: "src/app",
        text: null,
        binary: false,
        size: 0,
        truncated: false,
      });
      const absolute = await readLocalFile(root, join(root, "src"));
      expect(absolute.type).toBe("directory");
      expect(absolute.path.endsWith("/src")).toBe(true);
    });
  });

  test("resolves files and directories without allowing relative or symlink escapes", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "a", "b"), { recursive: true });
      await writeFile(join(root, "a", "b", "c.png"), "image");
      await symlink(join(root, ".."), join(root, "outside"));
      expect(
        await resolveLocalFilePaths(root, [
          "a/b/c.png",
          "a/b",
          "missing/file.png",
          "../outside.txt",
          "..",
          "outside",
          join(root, "a", "b"),
          join(root, ".."),
        ]),
      ).toEqual(["a/b/c.png", "a/b", join(root, "a", "b"), join(root, "..")]);
    });
  });

  test("uploads, overwrites, downloads, and deletes files", async () => {
    await withTempDir(async (root) => {
      const first = await uploadLocalFile(
        root,
        "",
        "notes.txt",
        Buffer.from("one"),
      );
      expect(first).toEqual({
        path: "notes.txt",
        size: 3,
        overwritten: false,
      });

      const second = await uploadLocalFile(
        root,
        "",
        "notes.txt",
        Buffer.from("two"),
      );
      expect(second.overwritten).toBe(true);

      const download = await downloadLocalFile(root, "notes.txt");
      expect(download).toMatchObject({
        filename: "notes.txt",
        path: "notes.txt",
        size: 3,
        contentType: "application/octet-stream",
      });
      expect(await new Response(download.body).text()).toBe("two");

      expect(await deleteLocalFile(root, "notes.txt")).toEqual({
        path: "notes.txt",
        type: "file",
      });
    });
  });

  test("rejects traversal for local relative operations", async () => {
    await withTempDir(async (root) => {
      await expect(listLocalFiles(root, "..", false)).rejects.toThrow(
        "file explorer path escaped the workspace checkout",
      );
      await expect(
        uploadLocalFile(root, "..", "x", Buffer.from("")),
      ).rejects.toThrow("file explorer path escaped the workspace checkout");
    });
  });
});
