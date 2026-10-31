import { expect, test } from "bun:test";
import { LinkClaims } from "./link-claims";
import {
  CheckoutResolver,
  linkWorkItems,
  type TopologyConnection,
} from "./links";
import { agentCheckoutTokens } from "../herdr/agent-checkout";
import type { WorkItem } from "../../../shared/worldSources";
import { SourcesService } from "./service";

const session = {
  source: "synthetic",
  agent: "fixture",
  kind: "id",
  value: "session-a",
};
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
const topology = (
  tokens: unknown = agentCheckoutTokens(
    session,
    "/synthetic/widgets",
    item(1).url,
  ),
): TopologyConnection[] => [
  {
    connection_id: "studio",
    generation: 1,
    snapshot_generation: 1,
    stale: false,
    snapshot: {
      workspaces: [],
      coverage: { panes: 1 },
      panes: [
        {
          pane_id: "pane-a",
          terminal_id: "terminal-a",
          agent: "fixture",
          cwd: "/synthetic/widgets",
          agent_session: session,
          state_change_seq: 17,
          tokens,
        },
      ],
    },
  },
];

test("actual linker retains both reported and inferred PR claims while keeping its legacy reported-first links", async () => {
  let now = 100,
    fail = false;
  const resolver = new CheckoutResolver(
    async () =>
      fail
        ? { code: 1, stdout: "", stderr: "unavailable" }
        : {
            code: 0,
            stdout:
              "branch-2\norigin\thttps://github.com/example-org/widgets.git (fetch)\n",
            stderr: "",
          },
    () => ({ kind: "local" }),
    () => now,
  );
  const claims = new LinkClaims();
  const observe = (
    connections = topology(),
    items = [item(1), item(2)],
    completeItems = true,
  ) =>
    linkWorkItems(connections, items, resolver, {
      claims,
      observedAt: now,
      completeItems,
    });
  const links = await observe();
  expect(links.map((link) => [link.itemKey, link.via])).toEqual([
    [item(1).key, "reported"],
  ]);
  const both = claims.values()[0]!.pr_links;
  expect(both.claims.map((claim) => claim.value)).toEqual([
    item(1).url,
    item(2).url,
  ]);
  expect(both.display).toEqual(both.claims);
  expect(both.claims[0]).toMatchObject({
    source: "herdr.metadata",
    basis: "reported",
    source_revision: 17,
    observed_at: 100,
  });
  expect(both.claims[0]!.author).toBeTruthy();
  expect(both.claims[1]).toMatchObject({
    source: "world.checkout",
    basis: "inferred",
    observed_at: 100,
  });
  now += 130_000;
  fail = true;
  await observe(topology({}));
  const silentSession = topology({});
  silentSession[0]!.snapshot!.panes[0]!.agent_session = null;
  await observe(silentSession);
  expect(
    claims.values()[0]!.pr_links.claims.map((claim) => claim.value),
  ).toEqual([item(2).url]);
  await observe([], [], false); // A failed topology read and another source's silence remove nothing.
  expect(
    claims.values()[0]!.pr_links.claims.map((claim) => claim.value),
  ).toEqual([item(2).url]);
  now += 130_000;
  fail = false;
  await observe(topology({}), [item(1)]);
  expect(claims.values()[0]!.pr_links.claims).toEqual([]);
});

test("partial, stale and ambiguous topology cannot remove claims; complete native absence retires the occupant", async () => {
  const resolver = new CheckoutResolver(
    async () => ({ code: 1, stdout: "", stderr: "" }),
    () => ({ kind: "local" }),
  );
  const claims = new LinkClaims();
  const observe = (connections: TopologyConnection[]) =>
    linkWorkItems(connections, [], resolver, {
      claims,
      observedAt: 100,
      completeItems: false,
    });
  await observe(topology());
  const original = claims.values();
  const partial = topology();
  partial[0]!.snapshot!.panes = []; // coverage still says one.
  await observe(partial);
  expect(claims.values()).toEqual(original);
  const stale = topology();
  stale[0]!.stale = true;
  await observe(stale);
  expect(claims.values()).toEqual(original);
  const ambiguous = topology({});
  ambiguous[0]!.snapshot!.panes.push({ ...ambiguous[0]!.snapshot!.panes[0] });
  await observe(ambiguous);
  expect(claims.values()).toEqual(original);
  const complete = topology();
  complete[0]!.snapshot!.panes = [];
  complete[0]!.snapshot!.coverage!.panes = 0;
  await observe(complete);
  expect(claims.values()).toEqual([]);
});

test("the actual service publishes both link claims and refuses verbs authorized only by a reported link", async () => {
  const run = async (argv: string[]) => {
    if (argv[0] !== "gh")
      return {
        code: 0,
        stdout:
          "branch-2\norigin\thttps://github.com/example-org/widgets.git (fetch)\n",
        stderr: "",
      };
    if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
    if (argv[1] !== "api")
      return { code: 1, stdout: "", stderr: "not available" };
    const nodes = [1, 2].map((number) => ({
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
    }));
    return {
      code: 0,
      stdout: JSON.stringify({
        data: {
          authored: { nodes },
          reviewing: { nodes: [] },
          assigned: { nodes: [] },
          merged: { nodes: [] },
          issues: { nodes: [] },
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
    topology: async () =>
      topology(
        agentCheckoutTokens(session, "/synthetic/widgets", item(999).url),
      ),
    resolver: new CheckoutResolver(
      run,
      () => ({ kind: "local" }),
      () => 100,
    ),
    now: () => 100,
    waitMs: 100,
  });
  const result = await service.snapshot();
  expect(
    result.linkClaims![0]!.pr_links.display.map((claim) => claim.value),
  ).toEqual([item(999).url, item(2).url]);
  // A reported URL outside the source's own records cannot become an action target.
  await expect(
    service.pullRequestVerb("github:pr:example-org/widgets#999", {
      verb: "close",
    }),
  ).rejects.toThrow();
  expect(result.links.map((link) => link.itemKey)).toEqual([item(2).key]);
});
