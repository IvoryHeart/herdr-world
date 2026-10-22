import { describe, expect, test } from "bun:test";
import {
  DEFAULT_JIRA_JQL,
  JIRA_NOT_CONFIGURED,
  normalizeJiraJql,
  normalizeJiraSite,
  normalizeJiraToken,
  parseJiraIssues,
  refreshJira,
} from "./jira";

const SITE = "https://example.atlassian.net";
const config = { site: SITE, email: "dev@example.com", jql: DEFAULT_JIRA_JQL };

const issue = (key: string, category: string, assignee = "acct-me") => ({
  key,
  fields: {
    summary: `Synthetic ticket ${key}`,
    status: { name: `Status of ${key}`, statusCategory: { key: category } },
    assignee: { accountId: assignee },
    updated: "2026-01-02T03:04:05.000+0000",
  },
});

describe("Jira source", () => {
  test("site accepts a bare host or https origin and nothing else", () => {
    expect(normalizeJiraSite("example.atlassian.net")).toBe(SITE);
    expect(normalizeJiraSite(" https://example.atlassian.net/ ")).toBe(SITE);
    expect(normalizeJiraSite("")).toBeNull();
    for (const bad of [
      "http://example.atlassian.net",
      "https://user:pw@example.atlassian.net",
      "https://example.atlassian.net/jira",
      "https://example.atlassian.net/?q=1",
    ])
      expect(() => normalizeJiraSite(bad)).toThrow();
  });

  test("an empty filter is the default; tokens have no spaces", () => {
    expect(normalizeJiraJql("  ")).toBe(DEFAULT_JIRA_JQL);
    expect(normalizeJiraJql("project = ABC")).toBe("project = ABC");
    expect(() => normalizeJiraToken("two words")).toThrow();
    expect(normalizeJiraToken(" synthetic-token ")).toBe("synthetic-token");
  });

  test("maps status categories to lanes and roles to the signed-in account", () => {
    const items = parseJiraIssues(
      {
        issues: [
          issue("ABC-1", "new"),
          issue("ABC-2", "indeterminate", "acct-other"),
          issue("ABC-3", "done"),
          { key: "not a key" },
        ],
      },
      SITE,
      "acct-me",
    );
    expect(
      items.map((item) => [item.ref, item.lane, item.roles, item.status]),
    ).toEqual([
      ["ABC-1", "todo", ["assignee"], "Status of ABC-1"],
      ["ABC-2", "doing", ["watcher"], "Status of ABC-2"],
      ["ABC-3", "done", ["assignee"], "Status of ABC-3"],
    ]);
    expect(items[0]!.url).toBe(`${SITE}/browse/ABC-1`);
  });

  test("without a site, email or token it is not connected and sends nothing", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("{}");
    };
    expect(await refreshJira(config, null, fetchImpl)).toEqual({
      ok: false,
      state: "not_connected",
      detail: JIRA_NOT_CONFIGURED,
    });
    expect(calls).toBe(0);
  });

  test("searches with Basic auth and the configured JQL", async () => {
    const requests: Request[] = [];
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/myself"))
        return Response.json({ accountId: "acct-me" });
      return Response.json({ issues: [issue("ABC-9", "indeterminate")] });
    };
    const result = await refreshJira(
      { ...config, jql: "project = ABC" },
      "synthetic-token",
      fetchImpl,
    );
    expect(result.ok && result.items.map((item) => item.ref)).toEqual([
      "ABC-9",
    ]);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/rest/api/3/myself",
      "/rest/api/3/search/jql",
    ]);
    expect(requests[0]!.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("dev@example.com:synthetic-token").toString("base64")}`,
    );
    expect(await requests[1]!.json()).toMatchObject({ jql: "project = ABC" });
  });

  test("a rejected token is not connected; a bad filter is an error", async () => {
    const rejected = await refreshJira(
      config,
      "synthetic-token",
      async () => new Response("", { status: 401 }),
    );
    expect(rejected).toMatchObject({ ok: false, state: "not_connected" });
    const badQuery = await refreshJira(
      config,
      "synthetic-token",
      async (input) =>
        String(input).endsWith("/myself")
          ? Response.json({ accountId: "acct-me" })
          : new Response("", { status: 400 }),
    );
    expect(badQuery).toMatchObject({ ok: false, state: "error" });
    expect(JSON.stringify(badQuery)).toContain("JQL");
  });
});
