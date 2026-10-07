import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canRevealFiles,
  fileManagerCommand,
  isLoopbackAddress,
  revealLocalPath,
} from "./file-manager";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function checkout() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "roamgate-file-manager-")),
  );
  roots.push(root);
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
  return root;
}

test("reveal capability requires explicit host opt-in and a loopback peer", () => {
  for (const value of [undefined, "", "0", "true"]) {
    expect(
      canRevealFiles("127.0.0.1", { HERDR_WORLD_ALLOW_FILE_REVEAL: value }),
    ).toBe(false);
  }
  const environment = { HERDR_WORLD_ALLOW_FILE_REVEAL: "1" };
  expect(canRevealFiles("127.0.0.1", environment)).toBe(true);
  expect(canRevealFiles("::1", environment)).toBe(true);
  expect(canRevealFiles("::ffff:127.0.0.1", environment)).toBe(true);
  expect(canRevealFiles("192.168.1.20", environment)).toBe(false);
});

test("identifies loopback transport addresses without inferring browser location", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    expect(isLoopbackAddress(address)).toBe(true);
  }
  for (const address of ["192.168.1.20", "::ffff:10.0.0.2", "fe80::1", ""]) {
    expect(isLoopbackAddress(address)).toBe(false);
  }
});

test.each([
  ["win32", false, ["explorer.exe", "/select,C:\\repo\\a.md"]],
  ["win32", true, ["explorer.exe", "C:\\repo\\docs"]],
  ["darwin", false, ["open", "-R", "/repo/a.md"]],
  ["darwin", true, ["open", "/repo/docs"]],
  ["linux", false, ["xdg-open", "/repo"]],
  ["linux", true, ["xdg-open", "/repo/docs"]],
] as const)(
  "%s opens a file's folder or the directory itself (directory=%s)",
  (platform, directory, expected) => {
    const target =
      platform === "win32"
        ? directory
          ? "C:\\repo\\docs"
          : "C:\\repo\\a.md"
        : directory
          ? "/repo/docs"
          : "/repo/a.md";
    expect(fileManagerCommand(platform, target, directory)).toEqual([
      ...expected,
    ]);
  },
);

test("relative files open their folder with the file selected", async () => {
  const root = await checkout();
  const calls: string[][] = [];

  const result = await revealLocalPath(root, "docs/guide.md", {
    platform: "win32",
    spawn: (argv) => calls.push(argv),
  });

  expect(result).toEqual({
    path: join(root, "docs", "guide.md"),
    type: "file",
  });
  expect(calls).toEqual([
    ["explorer.exe", `/select,${join(root, "docs", "guide.md")}`],
  ]);
});

test("directories open themselves", async () => {
  const root = await checkout();
  const calls: string[][] = [];

  const result = await revealLocalPath(root, "docs", {
    platform: "darwin",
    spawn: (argv) => calls.push(argv),
  });

  expect(result).toEqual({ path: join(root, "docs"), type: "directory" });
  expect(calls).toEqual([["open", join(root, "docs")]]);
});

test("relative paths cannot leave the checkout", async () => {
  const root = await checkout();
  const calls: string[][] = [];

  await expect(
    revealLocalPath(join(root, "docs"), "../docs/../..", {
      spawn: (argv) => calls.push(argv),
    }),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("missing paths fail without starting a file manager", async () => {
  const root = await checkout();
  const calls: string[][] = [];

  await expect(
    revealLocalPath(root, "docs/missing.md", {
      spawn: (argv) => calls.push(argv),
    }),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("a file manager that cannot start is reported", async () => {
  const root = await checkout();

  await expect(
    revealLocalPath(root, "docs", {
      platform: "linux",
      spawn: () => {
        throw new Error("ENOENT");
      },
    }),
  ).rejects.toThrow("Unable to start the file manager (xdg-open): ENOENT");
});
