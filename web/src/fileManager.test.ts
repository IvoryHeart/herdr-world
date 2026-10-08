import { expect, test } from "bun:test";
import {
  canRevealInFileManager,
  revealInFileManager,
  revealMenuLabel,
} from "./fileManager";

function fakeClient() {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    client: {
      isCurrent: () => true,
      call: async (method: string, params?: unknown) => {
        calls.push([method, params]);
        return {};
      },
    },
  };
}

test("menus require the server capability and a local profile", () => {
  expect(canRevealInFileManager({ type: "local" }, true)).toBe(true);
  for (const capability of [undefined, false, "true"]) {
    expect(canRevealInFileManager({ type: "local" }, capability)).toBe(false);
  }
  expect(canRevealInFileManager(undefined, true)).toBe(false);
  expect(canRevealInFileManager({ type: "ssh" }, true)).toBe(false);
  expect(canRevealInFileManager({ ssh_destination: "host" }, true)).toBe(false);
});

test("unknown host platforms never use the browser's platform", () => {
  expect(revealMenuLabel(false)).toBe("Reveal on host");
  expect(revealMenuLabel(true)).toBe("Open folder on host");
});

test("Changes paths stay Git-root-relative for backend existence checks", async () => {
  const { calls, client } = fakeClient();
  await revealInFileManager(
    client,
    "w1",
    "removed/ancestors/file.md",
    "changes",
  );
  expect(calls).toEqual([
    [
      "file.reveal",
      {
        workspace_id: "w1",
        path: "removed/ancestors/file.md",
        source: "changes",
      },
    ],
  ]);
});

test("labels name the host's file manager", () => {
  expect(revealMenuLabel(false, "windows")).toBe("Reveal in File Explorer");
  expect(revealMenuLabel(true, "windows")).toBe("Open in File Explorer");
  expect(revealMenuLabel(false, "mac")).toBe("Reveal in Finder");
  expect(revealMenuLabel(true, "mac")).toBe("Open in Finder");
  expect(revealMenuLabel(false, "linux")).toBe("Open containing folder");
  expect(revealMenuLabel(true, "linux")).toBe("Open folder");
});

test("checkout paths stay workspace-scoped", async () => {
  const { calls, client } = fakeClient();
  await revealInFileManager(client, "w1", "docs/guide.md");
  expect(calls).toEqual([
    ["file.reveal", { workspace_id: "w1", path: "docs/guide.md" }],
  ]);
});

test("absolute paths use the filesystem scope", async () => {
  const { calls, client } = fakeClient();
  await revealInFileManager(client, "w1", "C:\\Users\\me\\notes.md");
  await revealInFileManager(client, "w1", "/home/me/notes");
  expect(calls).toEqual([
    [
      "file.reveal",
      {
        workspace_id: "w1",
        path: "C:\\Users\\me\\notes.md",
        scope: "filesystem",
      },
    ],
    [
      "file.reveal",
      { workspace_id: "w1", path: "/home/me/notes", scope: "filesystem" },
    ],
  ]);
});
