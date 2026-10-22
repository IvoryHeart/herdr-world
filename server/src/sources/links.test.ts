import { describe, expect, test } from "bun:test";
import type { WorkItem } from "../../../shared/worldSources";
import {
  agentCheckoutSessionFingerprint,
  agentCheckoutTokens,
} from "../herdr/agent-checkout";
import type { RunProcess } from "./github";
import {
  CheckoutResolver,
  linkWorkItems,
  parseCheckout,
  type TopologyConnection,
} from "./links";

const session = {
  source: "herdr",
  agent: "claude",
  kind: "session",
  value: "synthetic-session",
};

const pullRequest = (
  number: number,
  branch: string,
  fields: Partial<WorkItem> = {},
): WorkItem => ({
  key: `github:pr:example-org/widgets#${number}`,
  source: "github",
  kind: "pull_request",
  ref: `example-org/widgets#${number}`,
  title: `Synthetic ${number}`,
  url: `https://github.com/example-org/widgets/pull/${number}`,
  lane: "review",
  status: "open",
  roles: ["author"],
  updatedAt: number,
  number,
  repo: "example-org/widgets",
  branch,
  ...fields,
});

const ticket: WorkItem = {
  key: "jira:ABC-12",
  source: "jira",
  kind: "ticket",
  ref: "ABC-12",
  title: "Synthetic ticket",
  url: "https://example.atlassian.net/browse/ABC-12",
  lane: "doing",
  status: "In Progress",
  roles: ["assignee"],
  updatedAt: 1,
};

const connection = (
  id: string,
  panes: Record<string, unknown>[],
  workspaces: Record<string, unknown>[] = [],
  stale = false,
): TopologyConnection => ({
  connection_id: id,
  generation: 3,
  snapshot_generation: 2,
  stale,
  snapshot: { workspaces, panes },
});

const gitOutput = (
  branch: string,
  remote = "git@github.com:example-org/widgets.git",
) => `${branch}\norigin\t${remote} (fetch)\norigin\t${remote} (push)\n`;

function fakeGit(byPath: Record<string, string>) {
  const calls: string[][] = [];
  const run: RunProcess = async (argv) => {
    calls.push(argv);
    const command = argv.at(-1)!;
    const path = Object.keys(byPath).find((entry) =>
      command.includes(`'${entry}'`),
    );
    return path
      ? { code: 0, stdout: byPath[path]!, stderr: "" }
      : { code: 1, stdout: "", stderr: "" };
  };
  return { run, calls };
}

describe("work links", () => {
  test("parses the branch and GitHub remotes only", () => {
    expect(
      parseCheckout(
        "agent/fix\norigin\thttps://github.com/example-org/widgets.git (fetch)\nmirror\tgit@git.example.com:widgets.git (fetch)\n",
      ),
    ).toEqual({ branch: "agent/fix", repos: ["example-org/widgets"] });
    expect(parseCheckout("")).toBeNull();
  });

  test("links an agent pane to the pull request of its checkout branch and the ticket it names", async () => {
    const { run } = fakeGit({
      "/work/widgets": gitOutput("agent/abc-12-login"),
    });
    const resolver = new CheckoutResolver(run, () => ({ kind: "local" }));
    const links = await linkWorkItems(
      [
        connection("local-1", [
          { pane_id: "p1", agent: "claude", cwd: "/work/widgets" },
          // Shells and panes elsewhere are not linked.
          { pane_id: "p2", cwd: "/work/widgets" },
          { pane_id: "p3", agent: "codex", cwd: "/elsewhere" },
        ]),
      ],
      [
        pullRequest(1, "agent/abc-12-login", { lane: "merged" }),
        pullRequest(2, "agent/abc-12-login"),
        pullRequest(3, "agent/other"),
        ticket,
      ],
      resolver,
    );
    // Links name the generation the pane was observed in.
    const linked = (itemKey: string) => ({
      connectionId: "local-1",
      generation: 2,
      paneId: "p1",
      sessionFingerprint: null,
      itemKey,
      via: "branch" as const,
    });
    expect(links).toEqual([
      linked("github:pr:example-org/widgets#2"),
      linked("jira:ABC-12"),
    ]);
  });

  test("a branch of the same name in another repository does not link", async () => {
    const { run } = fakeGit({
      "/work/widgets": gitOutput(
        "agent/fix",
        "https://github.com/example-org/gadgets",
      ),
    });
    const links = await linkWorkItems(
      [
        connection("local-1", [
          { pane_id: "p1", agent: "claude", cwd: "/work/widgets" },
        ]),
      ],
      [pullRequest(1, "agent/fix")],
      new CheckoutResolver(run, () => ({ kind: "local" })),
    );
    expect(links).toEqual([]);
  });

  test("a fork's pull request links only from a checkout of that fork", async () => {
    const fork = pullRequest(4, "feature/login", {
      headRepo: "someone/widgets",
    });
    const link = async (remote: string) => {
      const { run } = fakeGit({
        "/work/widgets": gitOutput("feature/login", remote),
      });
      return linkWorkItems(
        [
          connection("local-1", [
            { pane_id: "p1", agent: "claude", cwd: "/work/widgets" },
          ]),
        ],
        [fork],
        new CheckoutResolver(run, () => ({ kind: "local" })),
      );
    };
    // An upstream checkout on a branch of the same name is someone else's.
    expect(await link("git@github.com:example-org/widgets.git")).toEqual([]);
    expect(
      (await link("git@github.com:someone/widgets.git")).map(
        (entry) => entry.itemKey,
      ),
    ).toEqual([fork.key]);
  });

  test("an agent's reported pull request wins, and its reported path is used", async () => {
    const { run, calls } = fakeGit({
      "/work/reported": gitOutput("agent/other"),
    });
    const tokens = agentCheckoutTokens(
      session,
      "/work/reported",
      "https://github.com/example-org/widgets/pull/1",
    );
    const links = await linkWorkItems(
      [
        connection("local-1", [
          {
            pane_id: "p1",
            agent: "claude",
            agent_session: session,
            cwd: "/tmp",
            tokens,
          },
        ]),
      ],
      [pullRequest(1, "agent/fix"), pullRequest(3, "agent/other")],
      new CheckoutResolver(run, () => ({ kind: "local" })),
    );
    expect(links).toEqual([
      {
        connectionId: "local-1",
        generation: 2,
        paneId: "p1",
        sessionFingerprint: agentCheckoutSessionFingerprint(session),
        itemKey: "github:pr:example-org/widgets#1",
        via: "reported",
      },
    ]);
    expect(calls.at(-1)!.at(-1)).toContain("'/work/reported'");
  });

  test("a report from an earlier agent session is ignored", async () => {
    const { run } = fakeGit({});
    const tokens = agentCheckoutTokens(
      { ...session, value: "earlier-session" },
      "/work/reported",
      "https://github.com/example-org/widgets/pull/1",
    );
    const links = await linkWorkItems(
      [
        connection("local-1", [
          { pane_id: "p1", agent: "claude", agent_session: session, tokens },
        ]),
      ],
      [pullRequest(1, "agent/fix")],
      new CheckoutResolver(run, () => ({ kind: "local" })),
    );
    expect(links).toEqual([]);
  });

  test("falls back to the workspace checkout, runs git over SSH for SSH hosts, and skips stale or unsupported hosts", async () => {
    const { run, calls } = fakeGit({ "/srv/widgets": gitOutput("agent/fix") });
    const hosts: Record<
      string,
      ReturnType<ConstructorParameters<typeof CheckoutResolver>[1]>
    > = {
      "ssh-1": { kind: "ssh", destination: "builder.example.com" },
      "win-1": null,
    };
    const workspace = {
      workspace_id: "w1",
      worktree: { checkout_path: "/srv/widgets" },
    };
    const pane = { pane_id: "p1", agent: "codex", workspace_id: "w1" };
    const links = await linkWorkItems(
      [
        connection("ssh-1", [pane], [workspace]),
        connection("win-1", [pane], [workspace]),
        connection("stale-1", [pane], [workspace], true),
      ],
      [pullRequest(1, "agent/fix")],
      new CheckoutResolver(run, (id) => hosts[id] ?? null),
    );
    expect(links.map((link) => link.connectionId)).toEqual(["ssh-1"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 1)).toEqual(["ssh"]);
    expect(calls[0]).toContain("builder.example.com");
  });

  test("caches each checkout and bounds the lookups", async () => {
    let now = 0;
    const { run, calls } = fakeGit({ "/work/widgets": gitOutput("agent/fix") });
    const resolver = new CheckoutResolver(
      run,
      () => ({ kind: "local" }),
      () => now,
    );
    const panes = Array.from({ length: 40 }, (_, index) => ({
      pane_id: `p${index}`,
      agent: "claude",
      cwd: index < 2 ? "/work/widgets" : `/work/other-${index}`,
    }));
    const topology = [connection("local-1", panes)];
    await linkWorkItems(topology, [pullRequest(1, "agent/fix")], resolver);
    expect(calls).toHaveLength(32);
    await linkWorkItems(topology, [pullRequest(1, "agent/fix")], resolver);
    expect(calls).toHaveLength(32);
    now = 121_000;
    await linkWorkItems(topology, [pullRequest(1, "agent/fix")], resolver);
    expect(calls).toHaveLength(64);
  });
});
