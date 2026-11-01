import { expect, test } from "bun:test";
import { LinkClaims } from "./link-claims";
import {
  CheckoutResolver,
  linkWorkItems,
  type TopologyConnection,
} from "./links";
import { SourcesService } from "./service";
import type { WorkItem } from "../../../shared/worldSources";

const item = (number: number): WorkItem => ({
  key: `github:pr:example-org/widgets#${number}`,
  source: "github",
  kind: "pull_request",
  ref: `#${number}`,
  title: "Synthetic",
  url: `https://github.com/example-org/widgets/pull/${number}`,
  lane: "review",
  status: "open",
  roles: ["author"],
  updatedAt: 1,
  branch: `branch-${number}`,
  headRepo: "example-org/widgets",
});
const topology = (generation = 1): TopologyConnection[] => [
  {
    connection_id: "studio",
    generation,
    snapshot_generation: generation,
    stale: false,
    snapshot: {
      workspaces: [],
      coverage: { panes: 1 },
      panes: [
        {
          pane_id: "pane-a",
          terminal_id: `terminal-${generation}`,
          agent: "fixture",
          cwd: "/synthetic/widgets",
        },
      ],
    },
  },
];
const claim = {
  value: item(1).url,
  source: "world.checkout",
  observed_at: 100,
  basis: "inferred" as const,
};

for (const replacement of ["generation", "terminal"] as const)
  test(`a missing session cannot inherit its predecessor across ${replacement} replacement`, () => {
    const claims = new LinkClaims();
    const subject = {
      connectionId: "studio",
      generation: 1,
      paneId: "pane-a",
      terminalId: "terminal-a",
      sessionFingerprint: "session-a",
    };
    claims.observe(subject, null, claim);
    claims.observe({ ...subject, sessionFingerprint: null }, null, undefined);
    expect(claims.values()[0]!.sessionFingerprint).toBe("session-a");
    claims.observe(
      {
        ...subject,
        generation: replacement === "generation" ? 2 : 1,
        terminalId: replacement === "terminal" ? "terminal-b" : "terminal-a",
        sessionFingerprint: null,
      },
      null,
      undefined,
    );
    expect(claims.values()[0]!.sessionFingerprint).toBeNull();
    expect(claims.values()[0]!.pr_links.claims).toEqual([]);
  });

test("same-path checkout evidence is reread for a replacement generation and host", async () => {
  let branch = 1,
    calls = 0,
    host: { kind: "local" } | { kind: "ssh"; destination: string } = {
      kind: "local",
    };
  const resolver = new CheckoutResolver(
    async () => {
      calls++;
      return {
        code: 0,
        stdout: `branch-${branch}\norigin\thttps://github.com/example-org/widgets.git (fetch)\n`,
        stderr: "",
      };
    },
    () => host,
    () => 100,
  );
  const claims = new LinkClaims();
  const observe = (generation: number) =>
    linkWorkItems(topology(generation), [item(1), item(2), item(3)], resolver, {
      claims,
      observedAt: 100,
      completeItems: true,
    });
  await observe(1);
  branch = 2;
  await observe(2);
  expect(calls).toBe(2);
  expect(claims.values()[0]!.pr_links.claims[0]!.value).toBe(item(2).url);
  host = { kind: "ssh", destination: "synthetic.example.invalid" };
  branch = 3;
  await observe(2);
  expect(calls).toBe(3);
  expect(claims.values()[0]!.pr_links.claims[0]!.value).toBe(item(3).url);
});

for (const replacement of ["stale", "missing", "partial", "removed"] as const)
  test(`runtime retirement precedes ${replacement} replacement topology`, async () => {
    const resolver = new CheckoutResolver(
      async () => ({
        code: 0,
        stdout:
          "branch-1\norigin\thttps://github.com/example-org/widgets.git (fetch)\n",
        stderr: "",
      }),
      () => ({ kind: "local" }),
      () => 100,
    );
    const claims = new LinkClaims();
    const observe = (connections: TopologyConnection[]) =>
      linkWorkItems(connections, [item(1)], resolver, {
        claims,
        observedAt: 100,
        completeItems: true,
      });
    await observe(topology());
    const offline = topology();
    offline[0]!.stale = true;
    offline[0]!.snapshot = null;
    await observe(offline);
    expect(claims.values()).toHaveLength(1);
    const next = topology(2);
    if (replacement === "stale") {
      next[0]!.stale = true;
      next[0]!.snapshot_generation = 1;
    } else if (replacement === "missing") next[0]!.snapshot = null;
    else if (replacement === "partial") {
      next[0]!.snapshot!.panes = [];
    } else next.length = 0;
    await observe(next);
    expect(claims.values()).toEqual([]);
  });

test("successful truncated GitHub pages retain a branch claim until absence is complete", async () => {
  let now = 100,
    page = 0;
  const run = async (argv: string[]) => {
    if (argv[0] !== "gh")
      return {
        code: 0,
        stdout:
          "branch-1\norigin\thttps://github.com/example-org/widgets.git (fetch)\n",
        stderr: "",
      };
    if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
    if (!argv.at(-1)!.includes("authored: search"))
      return { code: 1, stdout: "", stderr: "unavailable detail" };
    const nodes = Array.from({ length: 50 }, (_, index) => {
      const number = index + 1 + (page ? 50 : 0);
      return {
        number,
        title: "Synthetic",
        url: item(number).url,
        state: "OPEN",
        isDraft: false,
        updatedAt: "2026-01-01T00:00:00Z",
        headRefName: `branch-${number}`,
        repository: { nameWithOwner: "example-org/widgets" },
        headRepository: { nameWithOwner: "example-org/widgets" },
        commits: { nodes: [] },
      };
    });
    const empty = { nodes: [], pageInfo: { hasNextPage: false } };
    return {
      code: 0,
      stdout: JSON.stringify({
        data: {
          authored: { nodes, pageInfo: { hasNextPage: page < 2 } },
          reviewing: empty,
          assigned: empty,
          merged: empty,
          issues: empty,
        },
      }),
      stderr: "",
    };
  };
  const service = new SourcesService({
    settings: { jira: { enabled: false } },
    persistSettings: async () => {},
    secrets: { read: () => ({}), write: () => {} },
    run,
    topology: async () => topology(),
    resolver: new CheckoutResolver(
      run,
      () => ({ kind: "local" }),
      () => now,
    ),
    now: () => now,
    waitMs: 100,
  });
  const first = await service.snapshot();
  expect(
    first.linkClaims![0]!.pr_links.claims.map((claim) => claim.value),
  ).toEqual([item(1).url]);
  now += 6000;
  page = 1;
  const partial = await service.snapshot(true);
  expect(partial.sources.find((source) => source.id === "github")!.state).toBe(
    "connected",
  );
  expect(
    partial.linkClaims![0]!.pr_links.claims.map((claim) => claim.value),
  ).toEqual([item(1).url]);
  now += 6000;
  page = 2;
  const complete = await service.snapshot(true);
  expect(complete.linkClaims![0]!.pr_links.claims).toEqual([]);
});

test("the service retires owners immediately, independently of its cached topology or pending link cadence", async () => {
  let now = 100,
    generation = 1;
  let owners = [{ connection_id: "studio", generation }];
  const node = {
    number: 1,
    title: "Synthetic",
    url: item(1).url,
    state: "OPEN",
    isDraft: false,
    updatedAt: "2026-01-01T00:00:00Z",
    headRefName: "branch-1",
    repository: { nameWithOwner: "example-org/widgets" },
    headRepository: { nameWithOwner: "example-org/widgets" },
    commits: { nodes: [] },
  };
  const empty = { nodes: [], pageInfo: { hasNextPage: false } };
  const run = async (argv: string[]) => {
    if (argv[0] !== "gh")
      return {
        code: 0,
        stdout:
          "branch-1\norigin\thttps://github.com/example-org/widgets.git (fetch)\n",
        stderr: "",
      };
    if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
    if (!argv.at(-1)!.includes("authored: search"))
      return { code: 1, stdout: "", stderr: "" };
    return {
      code: 0,
      stdout: JSON.stringify({
        data: {
          authored: { ...empty, nodes: [node] },
          reviewing: empty,
          assigned: empty,
          merged: empty,
        },
      }),
      stderr: "",
    };
  };
  const service = new SourcesService({
    settings: { jira: { enabled: false } },
    persistSettings: async () => {},
    secrets: { read: () => ({}), write: () => {} },
    run,
    runtimeOwners: () => owners,
    topology: async () => topology(generation),
    resolver: new CheckoutResolver(
      run,
      () => ({ kind: "local" }),
      () => now,
    ),
    now: () => now,
    waitMs: 100,
  });
  expect((await service.snapshot()).linkClaims).toHaveLength(1);
  owners = [{ connection_id: "studio", generation: 2 }];
  expect(service.current().linkClaims).toEqual([]);
  generation = 3;
  owners = [{ connection_id: "studio", generation }];
  now += 6000;
  expect((await service.snapshot(true)).linkClaims).toHaveLength(1);
  owners = [];
  expect(service.current().linkClaims).toEqual([]);
});
