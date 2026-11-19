import { expect, test } from "bun:test";
import { completeFolder, parentFolder, recentFolders } from "./recentFolders";

test("recent folders rank the focused pane first, then the latest activity, once each", () => {
  expect(
    recentFolders({
      workspaces: [
        { workspace_id: "w1", cwd: "/srv/example/docs" },
        {
          workspace_id: "w2",
          cwd: "/srv/example/repo",
          worktree: {
            checkout_path: "/srv/example/repo-topic/",
          } as never,
        },
        { workspace_id: "w3", cwd: "relative/folder" },
      ],
      panes: [
        {
          workspace_id: "w1",
          cwd: "/srv/example/docs",
          last_activity_at: 10,
        },
        {
          workspace_id: "w2",
          cwd: "/srv/example/repo-topic",
          foreground_cwd: "/srv/example/repo-topic/src",
          last_activity_at: 30,
        },
        { workspace_id: "w1", cwd: "~/notes", focused: true },
        { workspace_id: "w3", cwd: "/bad\u0007path", last_activity_at: 99 },
      ],
    }),
  ).toEqual([
    // The focused pane's room shares its rank; the host's order breaks it.
    "/srv/example/docs",
    "~/notes",
    "/srv/example/repo-topic/src",
    "/srv/example/repo-topic",
  ]);
  expect(recentFolders(null)).toEqual([]);
  expect(
    recentFolders(
      {
        panes: Array.from({ length: 9 }, (_, index) => ({
          workspace_id: "w",
          cwd: `/srv/example/${index}`,
          last_activity_at: index,
        })),
      },
      3,
    ),
  ).toEqual(["/srv/example/8", "/srv/example/7", "/srv/example/6"]);
});

test("a folder goes up one level and completes to the shared start of its suggestions", () => {
  expect(parentFolder("/srv/example/site/")).toBe("/srv/example");
  expect(parentFolder("/srv")).toBe("/");
  expect(parentFolder("/")).toBe(null);
  expect(parentFolder("~")).toBe(null);
  expect(parentFolder("~/notes")).toBe("~");

  expect(
    completeFolder("/srv/example/s", [
      "/srv/example/site",
      "/srv/example/sites-old",
    ]),
  ).toBe("/srv/example/site");
  expect(completeFolder("/srv/example/si", ["/srv/example/site"])).toBe(
    "/srv/example/site/",
  );
  expect(
    completeFolder("/srv/example/site", [
      "/srv/example/site",
      "/srv/example/site-b",
    ]),
  ).toBe(null);
  expect(completeFolder("/srv/example", [])).toBe(null);
});

test("Windows hosts' drive and UNC folders are offered, browsed up and completed", () => {
  expect(
    recentFolders({
      panes: [
        { workspace_id: "w", cwd: "C:\\Projects\\site\\", focused: true },
        {
          workspace_id: "w",
          cwd: "\\\\fileserver.example\\share\\docs",
          last_activity_at: 5,
        },
        { workspace_id: "w", cwd: "D:\\", last_activity_at: 4 },
        { workspace_id: "w", cwd: "C:relative", last_activity_at: 3 },
        {
          workspace_id: "w",
          cwd: "\\\\fileserver.example",
          last_activity_at: 2,
        },
      ],
    }),
  ).toEqual([
    "C:\\Projects\\site",
    "\\\\fileserver.example\\share\\docs",
    "D:\\",
  ]);
  expect(parentFolder("C:\\Projects\\site")).toBe("C:\\Projects");
  expect(parentFolder("C:\\Projects\\")).toBe("C:\\");
  expect(parentFolder("C:/Projects/site")).toBe("C:/Projects");
  expect(parentFolder("C:\\")).toBe(null);
  expect(parentFolder("\\\\fileserver.example\\share\\docs")).toBe(
    "\\\\fileserver.example\\share",
  );
  expect(parentFolder("\\\\fileserver.example\\share")).toBe(null);
  expect(parentFolder("~\\notes")).toBe("~");
  // A Unix name may hold a backslash: only slashes separate there.
  expect(parentFolder("/srv/odd\\name")).toBe("/srv");

  expect(completeFolder("C:\\Projects\\si", ["C:\\Projects\\site"])).toBe(
    "C:\\Projects\\site/",
  );
});
