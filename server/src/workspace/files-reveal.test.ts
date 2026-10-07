import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrClient } from "../bridge/herdr-client";
import { shQuote } from "../utils/process-utils";
import { revealLocalPath } from "./file-manager";
import { createFileHandlers } from "./files";
import { parseStatusSummary } from "./git-diff";

const roots: string[] = [];
const originalOptIn = process.env.HERDR_WORLD_ALLOW_FILE_REVEAL;
const originalLegacyOptIn = process.env.HERDR_GUI_ALLOW_FILE_REVEAL;

afterEach(async () => {
  if (originalOptIn === undefined)
    delete process.env.HERDR_WORLD_ALLOW_FILE_REVEAL;
  else process.env.HERDR_WORLD_ALLOW_FILE_REVEAL = originalOptIn;
  if (originalLegacyOptIn === undefined)
    delete process.env.HERDR_GUI_ALLOW_FILE_REVEAL;
  else process.env.HERDR_GUI_ALLOW_FILE_REVEAL = originalLegacyOptIn;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(sshHost?: string) {
  process.env.HERDR_WORLD_ALLOW_FILE_REVEAL = "1";
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "roamgate-reveal-handler-")),
  );
  roots.push(root);
  const checkout = join(root, "checkout");
  await mkdir(checkout);
  await writeFile(join(checkout, "existing.md"), "file");
  const launches: string[][] = [];
  const files = createFileHandlers({
    herdr: {
      call: async () => ({ workspace: { cwd: checkout } }),
    } as unknown as HerdrClient,
    sshHost: () => sshHost,
    runProcessWithCodeTimeout: async (argv) => {
      expect(argv).toEqual([
        "git",
        "-C",
        checkout,
        "rev-parse",
        "--show-toplevel",
      ]);
      // The Git root need not equal the explorer root.
      return { code: 0, stdout: root, stderr: "" };
    },
    shQuote,
    revealPath: (root, path, options) =>
      revealLocalPath(root, path, {
        ...options,
        platform: "darwin",
        spawn: (argv) => {
          launches.push(argv);
        },
      }),
  });
  const reveal = (params: Record<string, unknown>, peer = "127.0.0.1") =>
    files.revealWorkspaceFile({ workspace_id: "w1", ...params }, peer);
  return { root, checkout, launches, reveal };
}

test("handler denies reveal by default and for non-loopback peers", async () => {
  const { launches, reveal } = await fixture();
  delete process.env.HERDR_WORLD_ALLOW_FILE_REVEAL;
  delete process.env.HERDR_GUI_ALLOW_FILE_REVEAL;
  await expect(reveal({ path: "existing.md" })).rejects.toThrow("host opt-in");
  process.env.HERDR_WORLD_ALLOW_FILE_REVEAL = "1";
  await expect(reveal({ path: "existing.md" }, "192.168.1.2")).rejects.toThrow(
    "loopback peer",
  );
  expect(launches).toEqual([]);
});

test("handler refuses SSH profiles even with opt-in and a loopback peer", async () => {
  const { launches, reveal } = await fixture("remote");
  await expect(reveal({ path: "existing.md" })).rejects.toThrow(
    "local profile",
  );
  expect(launches).toEqual([]);
});

test("enabled local handler reveals existing files and preserves explorer ENOENT", async () => {
  const { checkout, launches, reveal } = await fixture();
  await expect(reveal({ path: "existing.md" })).resolves.toEqual({
    path: join(checkout, "existing.md"),
    type: "file",
  });
  await expect(reveal({ path: "missing/child.md" })).rejects.toThrow("ENOENT");
  expect(launches).toEqual([["open", "-R", join(checkout, "existing.md")]]);
});

test("Changes resolves missing files (including MD) and removed ancestor directories by existence", async () => {
  const { root, checkout, launches, reveal } = await fixture();
  const entries = parseStatusSummary("MD checkout/deleted.md\n");
  expect(entries.map((entry) => entry.status)).toEqual(["modified", "deleted"]);
  // Both rows of MD use the actual worktree, including the staged-modified row.
  for (const path of [
    ...entries.map((entry) => entry.path),
    "checkout/removed/deep/file.md",
    "checkout/removed",
  ]) {
    await expect(reveal({ path, source: "changes" })).resolves.toEqual({
      path: checkout,
      type: "directory",
    });
  }
  await expect(
    reveal({ path: "removed/deep/file.md", source: "changes" }),
  ).resolves.toEqual({ path: root, type: "directory" });
  await expect(
    reveal({ path: "checkout/existing.md", source: "changes" }),
  ).resolves.toEqual({ path: join(checkout, "existing.md"), type: "file" });
  expect(launches).toHaveLength(6);
});

test("Changes ascends past ENOTDIR while ordinary explorer requests still reject", async () => {
  const { checkout, launches, reveal } = await fixture();
  const ancestor = join(checkout, "dir");
  await writeFile(ancestor, "directory replaced by a file");
  await expect(reveal({ path: "dir/file.md" })).rejects.toThrow("ENOTDIR");
  expect(launches).toEqual([]);
  await expect(
    reveal({ path: "checkout/dir/file.md", source: "changes" }),
  ).resolves.toEqual({ path: ancestor, type: "file" });
  expect(launches).toEqual([["open", "-R", ancestor]]);
});

test("handler validates scope and Windows absolute paths on every host platform", async () => {
  const { root, launches, reveal } = await fixture();
  for (const scope of [undefined, "workspace"]) {
    for (const path of [
      "C:\\outside\\file.md",
      "C:/outside/file.md",
      "C:relative.md",
      "\\\\server\\share\\file.md",
      "\\rooted\\file.md",
      "/outside/file.md",
      "../outside.md",
    ]) {
      await expect(reveal({ path, scope })).rejects.toThrow();
      await expect(
        reveal({ path, scope, source: "changes" }),
      ).rejects.toThrow();
    }
  }
  await expect(
    reveal({ path: "existing.md", scope: "invalid" }),
  ).rejects.toThrow("scope");
  await expect(
    reveal({ path: "existing.md", scope: "filesystem" }),
  ).rejects.toThrow("absolute path");
  await expect(
    reveal({ path: root, scope: "filesystem", source: "changes" }),
  ).rejects.toThrow("Git-root-relative");
  expect(launches).toEqual([]);
  await expect(reveal({ path: root, scope: "filesystem" })).resolves.toEqual({
    path: root,
    type: "directory",
  });
});

test("workspace and Changes requests cannot escape through symlinks or missing ancestors", async () => {
  const { root, checkout, launches, reveal } = await fixture();
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), "roamgate-reveal-outside-")),
  );
  roots.push(outside);
  await symlink(outside, join(checkout, "outside"), "dir");
  await symlink(join(outside, "absent"), join(checkout, "dangling"), "dir");
  await symlink(outside, join(root, "outside"), "dir");
  for (const path of [
    "outside",
    "outside/missing/deep.md",
    "checkout/dangling/missing.md",
    "../missing/deep.md",
  ]) {
    await expect(reveal({ path, source: "changes" })).rejects.toThrow();
  }
  await expect(reveal({ path: "outside" })).rejects.toThrow("escaped");
  expect(launches).toEqual([]);
});
