import { expect, test } from "bun:test";
import {
  directoryPreviewName,
  directoryPreviewPath,
  normalizeFilesystemPath,
  parentFilesystemPath,
} from "./filesystemPaths";
import {
  absolutePath,
  isWorkspaceRelativePath,
} from "./components/fileExplorerResources";

test("filesystem parents stop at POSIX, drive, and share roots", () => {
  for (const [path, parent] of [
    ["/home/user/docs", "/home/user"],
    ["/home/", "/"],
    ["/", "/"],
    ["C:\\docs\\reference", "C:/docs"],
    ["C:/docs", "C:/"],
    ["C:/", "C:/"],
    ["//server/share/docs", "//server/share"],
    ["//server/share", "//server/share"],
  ])
    expect(parentFilesystemPath(path!)).toBe(parent!);
});

test("directory preview paths resolve against the preview root", () => {
  expect(directoryPreviewPath(null)).toBe(null);
  expect(directoryPreviewPath({ root: "/repo", path: "README.md" })).toBe(null);
  expect(
    directoryPreviewPath({
      type: "directory",
      root: "/repo",
      path: "src/app",
    }),
  ).toBe("/repo/src/app");
  expect(
    directoryPreviewPath({ type: "directory", root: "/repo/", path: "/" }),
  ).toBe("/");
  expect(
    directoryPreviewPath({
      type: "directory",
      root: "/repo",
      path: "/tmp/demo/",
    }),
  ).toBe("/tmp/demo");
  expect(
    directoryPreviewPath({
      type: "directory",
      root: "C:\\repo",
      path: "C:\\repo\\src",
    }),
  ).toBe("C:/repo/src");
});

test("directory preview names use the last path component", () => {
  expect(directoryPreviewName("/repo/src/app")).toBe("app");
  expect(directoryPreviewName("/repo")).toBe("repo");
  expect(directoryPreviewName("/")).toBe("");
});

test("filesystem paths normalize separators and trailing slashes", () => {
  expect(normalizeFilesystemPath("/repo/src/")).toBe("/repo/src");
  expect(normalizeFilesystemPath("/")).toBe("/");
  expect(normalizeFilesystemPath("C:\\repo\\src")).toBe("C:/repo/src");
});

test("copy paths do not prefix an absolute filesystem entry with the workspace", () => {
  expect(isWorkspaceRelativePath("/references/r.md")).toBe(false);
  expect(isWorkspaceRelativePath("C:/references/r.md")).toBe(false);
  expect(isWorkspaceRelativePath("docs/r.md")).toBe(true);
  const entry = {
    name: "r.md",
    path: "/references/r.md",
    type: "file" as const,
    size: 0,
    mtime_ms: 0,
    hidden: false,
  };
  expect(absolutePath("/workspace", entry)).toBe("/references/r.md");
  expect(absolutePath("/workspace", { ...entry, path: "docs/r.md" })).toBe(
    "/workspace/docs/r.md",
  );
  expect(
    absolutePath("C:\\Users\\me\\repo", { ...entry, path: "docs/r.md" }),
  ).toBe("C:\\Users\\me\\repo\\docs\\r.md");
  expect(absolutePath("C:\\", { ...entry, path: "docs/r.md" })).toBe(
    "C:\\docs\\r.md",
  );
  expect(absolutePath("C:/repo", { ...entry, path: "docs/r.md" })).toBe(
    "C:/repo/docs/r.md",
  );
});

test.each([
  ["/srv/repo\\name", "/srv/repo\\name/docs/r.md"],
  ["/srv/repo\\", "/srv/repo\\/docs/r.md"],
  ["\\\\server\\share\\repo", "\\\\server\\share\\repo\\docs\\r.md"],
  ["//server/share/repo", "//server/share/repo/docs/r.md"],
])(
  "copy and dragged paths preserve the host separators for %s",
  (root, expected) => {
    expect(
      absolutePath(root, {
        name: "r.md",
        path: "docs/r.md",
        type: "file",
        size: 0,
        mtime_ms: 0,
        hidden: false,
      }),
    ).toBe(expected);
  },
);
