import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuiSettings } from "../config/gui-settings";
import type { RunProcess } from "./github";
import {
  createSourcesHttpHandler,
  storedSourceSettings,
  WORLD_SOURCES_PATH,
  WORLD_SOURCES_SETTINGS_KEY,
  withSourceSettings,
} from "./http";
import { CheckoutResolver } from "./links";
import {
  readSourceSecrets,
  sourceSecretsPath,
  writeSourceSecrets,
  type SourceSecrets,
} from "./secrets";
import { SourcesService, type StoredSourceSettings } from "./service";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const graphql = {
  data: {
    authored: {
      nodes: [
        {
          number: 5,
          title: "Synthetic change",
          url: "https://github.com/example-org/widgets/pull/5",
          isDraft: false,
          state: "OPEN",
          updatedAt: "2026-01-01T00:00:00Z",
          headRefName: "agent/fix",
          reviewDecision: "APPROVED",
          mergeable: "MERGEABLE",
          repository: { nameWithOwner: "example-org/widgets" },
          headRepository: { nameWithOwner: "example-org/widgets" },
          commits: { nodes: [] },
        },
      ],
    },
    reviewing: { nodes: [] },
    assigned: { nodes: [] },
    merged: { nodes: [] },
    issues: { nodes: [] },
  },
};

function setup(
  options: {
    settings?: StoredSourceSettings;
    run?: RunProcess;
    fetchImpl?: typeof fetch;
    waitMs?: number;
  } = {},
) {
  let now = 1_000;
  let secrets: SourceSecrets = {};
  const saved: StoredSourceSettings[] = [];
  const counts = { gh: 0, jira: 0 };
  const run: RunProcess =
    options.run ??
    (async (argv) => {
      if (argv[0] === "gh") {
        counts.gh += 1;
        return argv[1] === "auth"
          ? { code: 0, stdout: "", stderr: "" }
          : { code: 0, stdout: JSON.stringify(graphql), stderr: "" };
      }
      return {
        code: 0,
        stdout:
          "agent/fix\norigin\thttps://github.com/example-org/widgets (fetch)\n",
        stderr: "",
      };
    });
  const fetchImpl =
    options.fetchImpl ??
    (async (input: string | URL | Request) => {
      counts.jira += 1;
      return String(input).endsWith("/myself")
        ? Response.json({ accountId: "acct-me" })
        : Response.json({
            issues: [
              {
                key: "ABC-1",
                fields: {
                  summary: "Synthetic ticket",
                  status: { name: "To Do", statusCategory: { key: "new" } },
                },
              },
            ],
          });
    });
  const service = new SourcesService({
    settings: options.settings ?? {},
    persistSettings: async (settings) => {
      saved.push(settings);
    },
    secrets: {
      read: () => secrets,
      write: (next) => {
        secrets = next;
      },
    },
    run,
    fetchImpl: fetchImpl as typeof fetch,
    topology: async () => [
      {
        connection_id: "local-1",
        generation: 1,
        stale: false,
        snapshot: {
          workspaces: [],
          panes: [{ pane_id: "p1", agent: "claude", cwd: "/work/widgets" }],
        },
      },
    ],
    resolver: new CheckoutResolver(run, () => ({ kind: "local" })),
    now: () => now,
    ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
  });
  return {
    service,
    handle: createSourcesHttpHandler(service),
    saved,
    counts,
    secrets: () => secrets,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const put = (path: string, body: unknown) =>
  new Request(`http://world.example${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("World sources service", () => {
  test("GitHub is on by default; Jira without settings says how to connect", async () => {
    const { service } = setup();
    const snapshot = await service.snapshot();
    expect(snapshot.sources.map((source) => [source.id, source.state])).toEqual(
      [
        ["github", "connected"],
        ["jira", "not_connected"],
      ],
    );
    expect(snapshot.items.map((item) => [item.ref, item.lane])).toEqual([
      ["example-org/widgets#5", "ready"],
    ]);
    expect(snapshot.links).toEqual([
      {
        connectionId: "local-1",
        generation: 1,
        paneId: "p1",
        sessionFingerprint: null,
        itemKey: "github:pr:example-org/widgets#5",
        via: "branch",
      },
    ]);
  });

  test("refreshes at most once per interval; forcing waits five seconds", async () => {
    const { service, counts, advance } = setup();
    await service.snapshot();
    await service.snapshot();
    expect(counts.gh).toBe(2);
    advance(60_000);
    await service.snapshot();
    expect(counts.gh).toBe(4);
    await service.snapshot(true);
    expect(counts.gh).toBe(4);
    advance(5_000);
    await service.snapshot(true);
    expect(counts.gh).toBe(6);
  });

  test("a slow source never holds a request: it answers with what it has and refreshing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run: RunProcess = async (argv) => {
      if (argv[0] !== "gh") return { code: 1, stdout: "", stderr: "" };
      if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
      await gate;
      return { code: 0, stdout: JSON.stringify(graphql), stderr: "" };
    };
    const { service } = setup({ run, waitMs: 5 });
    const first = await service.snapshot();
    expect(first.refreshing).toBe(true);
    expect(first.items).toEqual([]);
    release();
    await Bun.sleep(0);
    const later = await service.snapshot();
    expect(later.refreshing).toBe(false);
    expect(later.items).toHaveLength(1);
  });

  test("a switched-off source makes no requests and shows nothing", async () => {
    const { service, counts } = setup({
      settings: { github: { enabled: false } },
    });
    const snapshot = await service.snapshot();
    expect(counts.gh).toBe(0);
    expect(snapshot.sources[0]).toMatchObject({
      state: "disabled",
      itemCount: 0,
    });
    expect(snapshot.items).toEqual([]);
  });

  test("a failed refresh keeps the last items", async () => {
    let fail = false;
    const run: RunProcess = async (argv) =>
      argv[1] === "auth"
        ? { code: 0, stdout: "", stderr: "" }
        : fail
          ? { code: 1, stdout: "", stderr: "" }
          : argv[0] === "gh"
            ? { code: 0, stdout: JSON.stringify(graphql), stderr: "" }
            : { code: 1, stdout: "", stderr: "" };
    const { service, advance } = setup({ run });
    expect((await service.snapshot()).items).toHaveLength(1);
    fail = true;
    advance(5_000);
    const failed = await service.snapshot(true);
    expect(failed.sources[0]!.state).toBe("error");
    expect(failed.items).toHaveLength(1);
  });

  test("Jira settings save, the token stays private, and the browser sees only that it is set", async () => {
    const { handle, saved, secrets, counts } = setup();
    const response = await handle(
      put(`${WORLD_SOURCES_PATH}/jira`, {
        site: "example.atlassian.net",
        email: "dev@example.com",
        token: "synthetic-token",
      }),
      `${WORLD_SOURCES_PATH}/jira`,
    );
    expect(response?.status).toBe(200);
    const text = await response!.text();
    expect(text).not.toContain("synthetic-token");
    const body = JSON.parse(text);
    expect(body.sources[1]).toMatchObject({
      state: "connected",
      config: {
        kind: "jira",
        site: "https://example.atlassian.net",
        email: "dev@example.com",
        tokenSet: true,
      },
    });
    expect(body.items.map((item: { ref: string }) => item.ref)).toContain(
      "ABC-1",
    );
    expect(secrets()).toEqual({ jiraToken: "synthetic-token" });
    expect(JSON.stringify(saved)).not.toContain("synthetic-token");
    expect(counts.jira).toBe(2);
  });

  test("a new Jira site or email drops the saved token, so it is never sent elsewhere", async () => {
    const { handle, secrets } = setup();
    const save = (body: Record<string, unknown>) =>
      handle(
        put(`${WORLD_SOURCES_PATH}/jira`, body),
        `${WORLD_SOURCES_PATH}/jira`,
      );
    await save({
      site: "example.atlassian.net",
      email: "dev@example.com",
      token: "synthetic-token",
    });
    // Saving the same site and account keeps it.
    await save({ site: "example.atlassian.net", jql: "project = ABC" });
    expect(secrets()).toEqual({ jiraToken: "synthetic-token" });
    await save({ site: "other.example.com" });
    expect(secrets().jiraToken).toBeUndefined();
    await save({ email: "dev2@example.com", token: "second-token" });
    expect(secrets()).toEqual({ jiraToken: "second-token" });
    await save({ email: "dev@example.com" });
    expect(secrets().jiraToken).toBeUndefined();
  });

  test("rejects invalid settings without saving anything", async () => {
    const { handle, saved, secrets } = setup();
    for (const body of [
      { site: "http://example.atlassian.net", token: "synthetic-token" },
      { unknown: true },
      { enabled: "yes" },
    ]) {
      const response = await handle(
        put(`${WORLD_SOURCES_PATH}/jira`, body),
        `${WORLD_SOURCES_PATH}/jira`,
      );
      expect(response?.status).toBe(400);
    }
    const github = await handle(
      put(`${WORLD_SOURCES_PATH}/github`, { enabled: "no" }),
      `${WORLD_SOURCES_PATH}/github`,
    );
    expect(github?.status).toBe(400);
    expect(saved).toEqual([]);
    expect(secrets()).toEqual({});
  });

  test("switching GitHub off is saved and takes effect at once", async () => {
    const { handle, saved } = setup();
    const response = await handle(
      put(`${WORLD_SOURCES_PATH}/github`, { enabled: false }),
      `${WORLD_SOURCES_PATH}/github`,
    );
    const body = await response!.json();
    expect(body.sources[0].state).toBe("disabled");
    expect(saved.at(-1)).toEqual({ github: { enabled: false } });
  });

  test("the merged window is saved, reported and used; a bad one is refused", async () => {
    const queries: string[] = [];
    const run: RunProcess = async (argv) => {
      if (argv[0] !== "gh") return { code: 0, stdout: "", stderr: "" };
      if (argv[1] !== "auth") queries.push(argv.at(-1)!);
      return argv[1] === "auth"
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 0, stdout: JSON.stringify(graphql), stderr: "" };
    };
    const { service, handle, saved } = setup({ run });
    const path = `${WORLD_SOURCES_PATH}/github`;
    expect((await service.snapshot()).sources[0]!.config).toEqual({
      kind: "github",
      mergedDays: 7,
    });
    const response = await handle(put(path, { mergedDays: 30 }), path);
    const body = await response!.json();
    expect(body.sources[0].config).toEqual({ kind: "github", mergedDays: 30 });
    expect(saved.at(-1)).toEqual({ github: { mergedDays: 30 } });
    // 1,000 (setup's clock) minus 30 days.
    expect(queries.at(-1)).toContain(
      `merged:>=${new Date(1_000 - 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/u, "Z")}`,
    );
    for (const bad of [
      { mergedDays: 0 },
      { mergedDays: "7" },
      { other: 1 },
      {},
    ]) {
      const refused = await handle(put(path, bad), path);
      expect(refused!.status).toBe(400);
    }
    expect(saved).toHaveLength(1);
  });

  test("a new merged window keeps the current items if its read fails", async () => {
    let fail = false;
    const run: RunProcess = async (argv) => {
      if (argv[0] !== "gh") return { code: 0, stdout: "", stderr: "" };
      if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
      return fail
        ? { code: 1, stdout: "", stderr: "" }
        : { code: 0, stdout: JSON.stringify(graphql), stderr: "" };
    };
    const { service } = setup({ run });
    expect((await service.snapshot()).items.map((item) => item.ref)).toEqual([
      "example-org/widgets#5",
    ]);
    fail = true;
    const after = await service.configureGitHub({ mergedDays: 30 });
    expect(after.items.map((item) => item.ref)).toEqual([
      "example-org/widgets#5",
    ]);
    expect(after.sources[0]).toMatchObject({ state: "error", itemCount: 1 });
    // Switching a source off and on still starts from nothing.
    await service.configureGitHub({ enabled: false });
    expect((await service.configureGitHub({ enabled: true })).items).toEqual(
      [],
    );
  });

  test("without git, or outside a repository, pull requests show and only desk links are absent", async () => {
    for (const git of ["missing", "not a repository"] as const) {
      let gitCalls = 0;
      const run: RunProcess = async (argv) => {
        if (argv[0] === "gh")
          return argv[1] === "auth"
            ? { code: 0, stdout: "", stderr: "" }
            : { code: 0, stdout: JSON.stringify(graphql), stderr: "" };
        gitCalls += 1;
        if (git === "missing")
          throw Object.assign(new Error("spawn git"), { code: "ENOENT" });
        return {
          code: 128,
          stdout: "",
          stderr: "fatal: not a git repository",
        };
      };
      const { service, advance } = setup({ run });
      const snapshot = await service.snapshot();
      expect(snapshot.items.map((item) => item.ref)).toEqual([
        "example-org/widgets#5",
      ]);
      expect(snapshot.sources[0]).toMatchObject({ state: "connected" });
      expect(snapshot.links).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain("fatal");
      // The failed lookup is cached, not retried on every request.
      const calls = gitCalls;
      expect(calls).toBeGreaterThan(0);
      advance(20_000);
      await service.snapshot();
      expect(gitCalls).toBe(calls);
    }
  });

  test("settings round-trip through settings.json's custom block", () => {
    const base: GuiSettings = {
      version: 1,
      repositories: {},
      workspace_auto_sync: {},
      custom: { other: 1 },
    };
    const next = withSourceSettings(base, {
      github: { enabled: false },
      jira: {
        enabled: true,
        site: "https://example.atlassian.net",
        email: null,
        jql: null,
      },
    });
    expect(next.custom.other).toBe(1);
    expect(storedSourceSettings(next)).toEqual({
      github: { enabled: false },
      jira: {
        enabled: true,
        site: "https://example.atlassian.net",
        email: null,
        jql: null,
      },
    });
    expect(
      storedSourceSettings({ custom: { [WORLD_SOURCES_SETTINGS_KEY]: "bad" } }),
    ).toEqual({});
  });
});

describe("source secrets file", () => {
  test("is private, per settings file, and reads back only the token", () => {
    const root = mkdtempSync(join(tmpdir(), "world-sources-"));
    dirs.push(root);
    const path = sourceSecretsPath(join(root, "settings.json"), root);
    expect(path).not.toBe(sourceSecretsPath(undefined, root));
    expect(readSourceSecrets(path)).toEqual({});
    writeSourceSecrets({ jiraToken: "synthetic-token" }, path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readSourceSecrets(path)).toEqual({ jiraToken: "synthetic-token" });
    writeSourceSecrets({}, path);
    expect(readSourceSecrets(path)).toEqual({});
  });
});
