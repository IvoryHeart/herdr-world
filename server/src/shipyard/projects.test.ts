import { expect, test } from "bun:test";
import type { TopologyConnection } from "../sources/links";
import type { RunProcess } from "../sources/github";
import {
  openFolders,
  parseProjectCheckout,
  profileCheckoutHost,
  ShipyardProjects,
} from "./projects";

const connection = (
  id: string,
  workspaces: Record<string, unknown>[],
  panes: Record<string, unknown>[] = [],
  stale = false,
): TopologyConnection => ({
  connection_id: id,
  generation: 3,
  stale,
  snapshot: { workspaces, panes },
});

/** Git on a synthetic host: each folder's top folder and remotes. */
function git(
  checkouts: Record<string, { top: string; remotes?: string[] }>,
  hold?: Promise<void>,
) {
  const calls: string[][] = [];
  const run: RunProcess = async (argv) => {
    calls.push(argv);
    await hold;
    const command = argv.at(-1)!;
    const path = command.match(/git -C '([^']+)'/u)?.[1] ?? "";
    const checkout = checkouts[path];
    if (!checkout) return { code: 128, stdout: "", stderr: "not a git repo" };
    const remotes = (checkout.remotes ?? []).flatMap((line) => [
      `${line} (fetch)`,
      `${line} (push)`,
    ]);
    return {
      code: 0,
      stdout: [checkout.top, ...remotes].join("\n") + "\n",
      stderr: "",
    };
  };
  return { run, calls };
}

test("a room's folder is its checkout, else its own, else its first terminal's", () => {
  const { folders, omitted } = openFolders(
    [
      connection(
        "local",
        [
          {
            workspace_id: "w1",
            cwd: "/work/ignored",
            worktree: { checkout_path: "/work/widgets-feature" },
          },
          { workspace_id: "w2", cwd: "/work/gadgets" },
          { workspace_id: "w3" },
          { workspace_id: "w4", cwd: "relative/path" },
          { workspace_id: "w5", cwd: "/work/gadgets" },
        ],
        [{ workspace_id: "w3", cwd: "/work/notes" }],
      ),
      // A failed host's cached topology is stale: it opens no lane.
      connection("gone", [{ workspace_id: "w1", cwd: "/work/old" }], [], true),
    ],
    64,
  );
  expect(omitted).toBe(0);
  expect(folders.map((f) => [f.path, f.rooms, f.generation])).toEqual([
    ["/work/widgets-feature", 1, 3],
    ["/work/gadgets", 2, 3],
    ["/work/notes", 1, 3],
  ]);
});

test("folders past the limit are counted, not dropped silently", () => {
  const workspaces = Array.from({ length: 5 }, (_, index) => ({
    workspace_id: `w${index}`,
    cwd: `/work/p${index}`,
  }));
  const { folders, omitted } = openFolders(
    [connection("local", workspaces)],
    3,
  );
  expect(folders).toHaveLength(3);
  expect(omitted).toBe(2);
});

test("the GitHub remote is origin's first, and a checkout without one keeps its name", () => {
  expect(
    parseProjectCheckout(
      [
        "/work/widgets",
        "upstream\thttps://github.com/Upstream-Org/Widgets.git (fetch)",
        "origin\thttps://github.com/Example-Org/Widgets (fetch)",
        "origin\thttps://github.com/Example-Org/Widgets (push)",
      ].join("\n"),
    ),
  ).toEqual({
    toplevel: "/work/widgets",
    name: "widgets",
    repo: "example-org/widgets",
  });
  expect(
    parseProjectCheckout(
      "/work/notes\nmirror\thttps://git.example.com/a/notes.git (fetch)\n",
    ),
  ).toEqual({ toplevel: "/work/notes", name: "notes", repo: null });
  expect(parseProjectCheckout("")).toBeNull();
});

test("open projects: one per repository, checkouts without GitHub as such, plain folders none", async () => {
  const { run, calls } = git({
    "/work/widgets": {
      top: "/work/widgets",
      remotes: ["origin\thttps://github.com/example-org/widgets.git"],
    },
    "/work/widgets-feature": {
      top: "/work/widgets-feature",
      remotes: ["origin\thttps://github.com/example-org/widgets.git"],
    },
    "/srv/zebra": {
      top: "/srv/zebra",
      remotes: ["origin\thttps://github.com/example-org/zebra"],
    },
    "/work/scratch": { top: "/work/scratch" },
  });
  const projects = new ShipyardProjects({
    run,
    hostOf: (id) =>
      id === "local"
        ? { kind: "local" }
        : id === "remote"
          ? { kind: "ssh", destination: "devbox" }
          : null,
    topology: async () => [
      connection("local", [
        { workspace_id: "w1", cwd: "/work/widgets" },
        { workspace_id: "w2", cwd: "/work/widgets-feature" },
        { workspace_id: "w3", cwd: "/work/scratch" },
        { workspace_id: "w4", cwd: "/srv/plain-folder" },
      ]),
      connection("remote", [{ workspace_id: "r1", cwd: "/srv/zebra" }]),
    ],
  });
  const open = await projects.read();
  expect(open).toEqual({
    projects: [
      { repo: "example-org/widgets", name: "widgets", rooms: 2 },
      { repo: "example-org/zebra", name: "zebra", rooms: 1 },
      { repo: null, name: "scratch", rooms: 1 },
    ],
    pending: 0,
    omitted: 0,
  });
  // The remote room is read on its own host, over SSH.
  expect(
    calls.some((argv) => argv[0] === "ssh" && argv.includes("devbox")),
  ).toBe(true);
  // Cached: a second read asks Git nothing.
  const count = calls.length;
  await projects.read();
  expect(calls.length).toBe(count);
});

test("a project that closes leaves; slow folders are pending, then join", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let workspaces: Record<string, unknown>[] = [
    { workspace_id: "w1", cwd: "/work/widgets" },
  ];
  const { run } = git(
    {
      "/work/widgets": {
        top: "/work/widgets",
        remotes: ["origin\thttps://github.com/example-org/widgets.git"],
      },
    },
    hold,
  );
  const projects = new ShipyardProjects({
    run,
    hostOf: () => ({ kind: "local" }),
    topology: async () => [connection("local", workspaces)],
    waitMs: 0,
  });
  expect(await projects.read()).toEqual({
    projects: [],
    pending: 1,
    omitted: 0,
  });
  release();
  await hold;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((await projects.read()).projects).toHaveLength(1);
  workspaces = [];
  expect((await projects.read()).projects).toEqual([]);
});

test("folders are read locally or over SSH, never on Windows or unknown connections", () => {
  expect(profileCheckoutHost({ type: "local" })).toEqual({ kind: "local" });
  expect(
    profileCheckoutHost({ type: "ssh", ssh_destination: "devbox" }),
  ).toEqual({ kind: "ssh", destination: "devbox" });
  expect(
    profileCheckoutHost({
      type: "ssh",
      ssh_destination: "devbox",
      remote_platform: "windows",
    }),
  ).toBeNull();
  expect(profileCheckoutHost(undefined)).toBeNull();
});
