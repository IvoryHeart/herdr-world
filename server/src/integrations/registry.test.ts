import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  connectFor,
  connectedProvider,
  WORLD_INTEGRATIONS_PATH,
  type IntegrationsSnapshot,
} from "../../../shared/integrations";
import { normalizeWeatherSettings } from "../../../shared/weather";
import type { WorldSourceStatus } from "../../../shared/worldSources";
import type { WorldIntegrationStatus } from "../cli/integration";
import { createTestCli } from "../cli/test-context";
import type { OfficeObservabilityConfiguration } from "../world/observability";
import {
  createIntegrationsHttpHandler,
  serviceIntegrationsInputs,
} from "./http";
import {
  harnessEntry,
  integrationsSnapshot,
  metricsEntry,
  type RuntimeInput,
  runtimeEntry,
  sourceEntry,
} from "./registry";
import { fileVault } from "./vault";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const runtime = (patch: Partial<RuntimeInput> = {}): RuntimeInput => ({
  id: "conn-a",
  label: "Laptop",
  runtime: "herdr",
  state: "ready",
  generation: 3,
  transport: "local",
  readOnly: false,
  ...patch,
});

const github = (patch: Partial<WorldSourceStatus> = {}): WorldSourceStatus => ({
  id: "github",
  label: "GitHub",
  enabled: true,
  state: "connected",
  detail: "Signed in to GitHub.",
  checkedAt: 1,
  lastSuccessAt: 1,
  itemCount: 2,
  config: { kind: "github", mergedDays: 7 },
  ...patch,
});

const jira = (
  patch: Partial<WorldSourceStatus> = {},
  config: Partial<Extract<WorldSourceStatus["config"], { kind: "jira" }>> = {},
): WorldSourceStatus => ({
  id: "jira",
  label: "Jira",
  enabled: false,
  state: "disabled",
  detail: "Off.",
  checkedAt: 1,
  lastSuccessAt: null,
  itemCount: 0,
  config: {
    kind: "jira",
    site: "",
    email: "",
    jql: "",
    tokenSet: false,
    ...config,
  },
  ...patch,
});

const metrics = (
  patch: Partial<OfficeObservabilityConfiguration> = {},
): OfficeObservabilityConfiguration => ({
  providerId: "none",
  configured: false,
  endpoint: null,
  source: "none",
  health: "unavailable",
  healthReason: null,
  observedAt: 1,
  lastSuccessAt: null,
  ...patch,
});

const skill = (
  patch: Partial<WorldIntegrationStatus> = {},
): WorldIntegrationStatus => ({
  harness: "claude",
  state: "not_installed",
  available_version: 2,
  path: "~/.claude/skills/herdr-world/SKILL.md",
  shared_with: [],
  ...patch,
});

describe("runtime rows", () => {
  test("carry their exact connection and map each connection state", () => {
    const row = runtimeEntry(runtime());
    expect(row).toMatchObject({
      id: "runtime:conn-a",
      kind: "runtime",
      type: "herdr",
      state: "connected",
      control: "connection",
      connection: {
        id: "conn-a",
        generation: 3,
        transport: "local",
        lifecycle: "ready",
      },
      provides: ["terminals", "agents", "files"],
    });
    expect(runtimeEntry(runtime({ state: "disconnected" })).state).toBe(
      "available",
    );
    expect(runtimeEntry(runtime({ state: "connecting" })).state).toBe(
      "available",
    );
    expect(runtimeEntry(runtime({ state: "reconnecting" })).state).toBe(
      "error",
    );
    const failed = runtimeEntry(
      runtime({ state: "error", error: "host unreachable" }),
    );
    expect(failed.state).toBe("error");
    expect(failed.detail).toContain("host unreachable");
  });

  test("show an SSH destination and a core runtime by type", () => {
    const row = runtimeEntry(
      runtime({
        runtime: "herdr-core",
        transport: "ssh",
        sshDestination: "dev@example.test",
        readOnly: true,
      }),
    );
    expect(row.type).toBe("herdr-core");
    expect(row.detail).toStartWith("herdr-core");
    expect(row.settings).toContainEqual({
      key: "ssh_destination",
      label: "SSH destination",
      value: "dev@example.test",
    });
    expect(row.settings).toContainEqual({
      key: "read_only",
      label: "Read only",
      value: true,
    });
  });
});

describe("source rows", () => {
  test("map source states and never carry the token", () => {
    expect(sourceEntry(github()).state).toBe("connected");
    expect(
      sourceEntry(github({ enabled: false, state: "disabled" })).state,
    ).toBe("available");
    expect(
      sourceEntry(github({ state: "not_connected", detail: "Sign in" })).state,
    ).toBe("needs_connect");
    expect(sourceEntry(github({ state: "error" })).state).toBe("error");
    expect(sourceEntry(jira()).state).toBe("needs_connect");
    const ready = sourceEntry(
      jira(
        {},
        {
          site: "https://example.atlassian.net",
          email: "a@example.test",
          tokenSet: true,
        },
      ),
    );
    expect(ready.state).toBe("available");
    expect(ready.settings).toContainEqual({
      key: "token",
      label: "API token",
      value: true,
      secret: true,
    });
  });

  test("Weather maps through the registry without becoming a work provider", () => {
    const status: WorldSourceStatus = {
      id: "weather",
      label: "Weather",
      enabled: false,
      state: "disabled",
      detail: "Weather is off.",
      checkedAt: 1,
      lastSuccessAt: null,
      itemCount: 0,
      config: { kind: "weather", ...normalizeWeatherSettings({}) },
    };
    const row = sourceEntry(status);
    expect(row).toMatchObject({
      id: "source:weather",
      control: "source",
      state: "available",
      provides: ["weather"],
    });
    expect(row.settings).toEqual([
      { key: "location", label: "Weather location", value: null },
      { key: "browser_location", label: "Browser location", value: null },
    ]);
    expect(
      connectedProvider([{ ...row, state: "connected" }], "pull_requests"),
    ).toBeNull();
    expect(
      sourceEntry({ ...status, enabled: true, state: "not_connected" }).state,
    ).toBe("needs_connect");
    expect(
      sourceEntry({ ...status, enabled: true, state: "error" }).state,
    ).toBe("error");
    expect(
      sourceEntry({ ...status, enabled: true, state: "connected" }).state,
    ).toBe("connected");
    const configured = sourceEntry({
      ...status,
      config: {
        kind: "weather",
        ...normalizeWeatherSettings({
          location: "Example City",
          browserLocation: { latitude: 1.2, longitude: 2.3 },
        }),
      },
    });
    expect(configured.settings).toContainEqual({
      key: "location",
      label: "Weather location",
      value: "Example City",
    });
    expect(configured.settings).toContainEqual({
      key: "browser_location",
      label: "Browser location",
      value: "1.2, 2.3",
    });
  });

  test("usage metrics need a URL, then report health", () => {
    expect(metricsEntry(metrics()).state).toBe("needs_connect");
    const configured = {
      configured: true,
      endpoint: "http://127.0.0.1:9090",
      providerId: "prometheus",
      source: "settings" as const,
    };
    expect(
      metricsEntry(metrics({ ...configured, health: "available" })).state,
    ).toBe("connected");
    expect(metricsEntry(metrics(configured)).state).toBe("available");
    expect(
      metricsEntry(
        metrics({ ...configured, healthReason: "provider_query_failed" }),
      ).state,
    ).toBe("error");
  });
});

describe("harness rows", () => {
  test("list installed harnesses and those carrying World's skill", () => {
    expect(harnessEntry({ skill: skill(), detected: false })).toBeNull();
    expect(harnessEntry({ skill: skill(), detected: true })).toMatchObject({
      id: "harness:claude",
      label: "Claude Code",
      state: "available",
      control: "skill",
    });
    expect(
      harnessEntry({ skill: skill({ state: "current" }), detected: false })
        ?.state,
    ).toBe("connected");
    expect(
      harnessEntry({ skill: skill({ state: "outdated" }), detected: true })
        ?.detail,
    ).toContain("out of date");
  });

  test("a shared skill file alone does not list a harness", () => {
    const shared = skill({
      harness: "pi",
      state: "current",
      shared_with: ["codex", "kimi"],
    });
    expect(harnessEntry({ skill: shared, detected: false })).toBeNull();
    expect(harnessEntry({ skill: shared, detected: true })?.state).toBe(
      "connected",
    );
  });

  test("an unsupported harness is shown without a Connect", () => {
    const row = harnessEntry({
      skill: skill({ harness: "letta", state: "unsupported", path: undefined }),
      detected: true,
    });
    expect(row).toMatchObject({ control: "none", provides: ["agents"] });
  });
});

describe("the snapshot", () => {
  test("keeps the other owners' rows when one fails", async () => {
    const snapshot = await integrationsSnapshot({
      runtimes: () => {
        throw new Error("synthetic");
      },
      sources: async () => [github()],
      metrics: () => metrics(),
      harnesses: () => [],
      vault: () => {
        throw new Error("synthetic");
      },
      now: () => 42,
    });
    expect(snapshot.observedAt).toBe(42);
    expect(snapshot.integrations.map((entry) => entry.id)).toEqual([
      "source:github",
      "source:metrics",
    ]);
    expect(snapshot.vault.secrets).toEqual([]);
  });

  test("elements use a connected provider, else the row to connect", () => {
    const rows = [
      runtimeEntry(runtime({ id: "a", state: "disconnected" })),
      runtimeEntry(runtime({ id: "b", state: "error" })),
      sourceEntry(github({ state: "not_connected" })),
    ];
    expect(connectedProvider(rows, "terminals")).toBeNull();
    expect(connectFor(rows, "terminals")?.id).toBe("runtime:a");
    expect(connectFor(rows, "pull_requests")?.id).toBe("source:github");
    expect(connectFor(rows, "editor")).toBeNull();
    const ready = [runtimeEntry(runtime({ id: "c" })), ...rows];
    expect(connectedProvider(ready, "terminals")?.id).toBe("runtime:c");
    expect(connectFor(ready, "terminals")).toBeNull();
  });
});

test("a fresh install lists what it would add and needs nothing", async () => {
  const cli = createTestCli();
  dirs.push(cli.home);
  mkdirSync(join(cli.home, ".claude"));
  const handler = createIntegrationsHttpHandler(
    serviceIntegrationsInputs({
      profiles: { list: () => [], coreList: () => [] },
      sources: {
        snapshot: async () => ({
          observedAt: 1,
          refreshing: false,
          sources: [
            github({ state: "not_connected", detail: "Sign in with gh." }),
            jira(),
          ],
          items: [],
          links: [],
          actions: [],
        }),
      },
      metrics: { configuration: () => metrics() },
      runtime: () => cli.context.runtime,
      vault: fileVault(join(cli.home, "vault.json")),
      now: () => 7,
    }),
  );
  expect(
    await handler(
      new Request("http://world.test/api/world/other"),
      "/api/world/other",
    ),
  ).toBeNull();
  const put = await handler(
    new Request(`http://world.test${WORLD_INTEGRATIONS_PATH}`, {
      method: "PUT",
    }),
    WORLD_INTEGRATIONS_PATH,
  );
  expect(put?.status).toBe(405);
  const response = await handler(
    new Request(`http://world.test${WORLD_INTEGRATIONS_PATH}`),
    WORLD_INTEGRATIONS_PATH,
  );
  expect(response?.headers.get("cache-control")).toBe("no-store");
  const body = (await response!.json()) as IntegrationsSnapshot;
  expect(body.integrations.map((entry) => [entry.id, entry.state])).toEqual([
    ["source:github", "needs_connect"],
    ["source:jira", "needs_connect"],
    ["source:metrics", "needs_connect"],
    ["harness:claude", "available"],
  ]);
  expect(body.vault).toMatchObject({ backend: "file", secrets: [] });
});
