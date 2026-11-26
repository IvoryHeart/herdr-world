import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptsDependencyPR,
  maintenanceBody,
  publishMaintenance,
  shippedGraphChanged,
  type DependencyPR,
} from "./dependency-maintenance";
import type { AppLock } from "./dependency-security";
import { checkPrBodyText } from "./check-pr-body";

const pr: DependencyPR = {
  number: 42,
  body: "Dependency update",
  user: { login: "dependabot[bot]", type: "Bot" },
  base: {
    sha: "b".repeat(40),
    ref: "main",
    repo: { full_name: "example/project" },
  },
  head: {
    sha: "a".repeat(40),
    ref: "dependabot/update",
    repo: { full_name: "example/project" },
  },
};
test("automation is restricted to same-repository Dependabot data updates", () => {
  expect(acceptsDependencyPR(pr, ["bun.lock", "web/package.json"])).toBe(true);
  expect(
    acceptsDependencyPR(pr, [".github/workflows/behavioral-verification.yml"]),
  ).toBe(true);
  expect(
    acceptsDependencyPR({ ...pr, user: { login: "person", type: "User" } }, [
      "bun.lock",
    ]),
  ).toBe(false);
  expect(
    acceptsDependencyPR(
      { ...pr, head: { ...pr.head, repo: { full_name: "fork/project" } } },
      ["bun.lock"],
    ),
  ).toBe(false);
  for (const path of [
    "scripts/check-pr-body.ts",
    "security/dependency-exceptions.json",
    "server/src/index.ts",
    ".github/dependabot.yml",
    "changes/dependencies-99.md",
    "../package.json",
  ])
    expect(acceptsDependencyPR(pr, ["bun.lock", path])).toBe(false);
});
test("shipped transitive changes are distinguished from development updates", () => {
  const base: AppLock = {
    workspaces: { web: { dependencies: { app: "1" } }, server: {} },
    packages: {
      app: ["app@1.0.0", "", { dependencies: { leaf: "1" } }],
      leaf: ["leaf@1.0.0", "", {}],
      tool: ["tool@1.0.0", "", {}],
    },
  };
  const head = structuredClone(base);
  head.packages.tool![0] = "tool@2.0.0";
  expect(shippedGraphChanged(base, head)).toBe(false);
  head.packages.leaf![0] = "leaf@1.0.1";
  expect(shippedGraphChanged(base, head)).toBe(true);
  const first = maintenanceBody(pr.body);
  expect(maintenanceBody(first)).toBe(first);
});

test("generated descriptions pass PR policy for shipped and dev updates with a platform-optional lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "dependency-body-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    const lock = Bun.JSONC.parse(
      await Bun.file(
        new URL("./fixtures/dependency-maintenance/bun.lock", import.meta.url),
      ).text(),
    ) as AppLock;
    await writeFile(join(root, "bun.lock"), JSON.stringify(lock));
    git("add", "bun.lock");
    git("commit", "--quiet", "-m", "base fixture");
    const base = git("rev-parse", "HEAD");
    for (const shipped of [false, true]) {
      const head = structuredClone(lock);
      head.packages[shipped ? "app" : "tool"]![0] =
        `${shipped ? "app" : "tool"}@1.0.1`;
      expect(shippedGraphChanged(lock, head)).toBe(shipped);
      await writeFile(join(root, "bun.lock"), JSON.stringify(head));
      git("add", ".");
      git("commit", "--quiet", "-m", "dependency fixture");
      const first = maintenanceBody(pr.body);
      const body = maintenanceBody(first);
      expect(body).toBe(first);
      expect(checkPrBodyText(body, root, base)).toEqual([]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishing advances only the expected bot head, emits only docs and explicitly starts checks", async () => {
  const calls: {
    path: string;
    method?: string;
    data: Record<string, unknown>;
  }[] = [];
  const request = async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method,
      data: init?.body ? JSON.parse(String(init.body)) : {},
    });
    if (!init)
      return path.includes("/pulls/") ? pr : { tree: { sha: "base-tree" } };
    return { sha: "generated-commit-or-tree" };
  };
  const plan = {
    head: pr.head.sha,
    body: maintenanceBody(pr.body),
    files: {
      "DEPENDENCY_NOTICES.md": "Synthetic dependency notices.\n",
    },
  };
  await publishMaintenance(pr, plan, request);
  expect(
    calls.find((call) => call.path.endsWith("/git/commits"))?.data.parents,
  ).toEqual([pr.head.sha]);
  expect(
    calls.find((call) => call.path.includes("/git/refs/heads/"))?.data.force,
  ).toBe(false);
  expect(
    calls
      .filter((call) => call.path.endsWith("/dispatches"))
      .map((call) => call.path),
  ).toEqual([
    "/repos/example/project/actions/workflows/ci.yml/dispatches",
    "/repos/example/project/actions/workflows/dependency-security.yml/dispatches",
  ]);
  calls.length = 0;
  await expect(
    publishMaintenance(
      pr,
      { ...plan, files: { "server/src/index.ts": "evil" } },
      request,
    ),
  ).rejects.toThrow("identity/revision changed");
  expect(calls.every((call) => !call.method)).toBe(true);
  await expect(
    publishMaintenance(pr, plan, async () => ({
      ...pr,
      head: { ...pr.head, sha: "c".repeat(40) },
    })),
  ).rejects.toThrow("identity/revision changed");
});

test("a changed runtime resolution is detected even when all versions already ship elsewhere", () => {
  const base: AppLock = {
    workspaces: {
      web: { dependencies: { app: "1" } },
      server: { dependencies: { old: "1", next: "2" } },
    },
    packages: {
      app: ["app@1.0.0", "", {}],
      old: ["app@1.0.0", "", {}],
      next: ["app@2.0.0", "", {}],
    },
  };
  const head = structuredClone(base);
  head.packages.app![0] = "app@2.0.0";
  head.workspaces.web!.dependencies!.app = "2";
  expect(shippedGraphChanged(base, head)).toBe(true);
});

test("a workspace-specific runtime update requires a shipped dependency fragment", () => {
  const base: AppLock = {
    workspaces: {
      web: { name: "herdr-world-web", dependencies: { app: "1" } },
      server: { dependencies: { app: "2" } },
    },
    packages: {
      app: ["app@2.0.0", "", {}],
      "herdr-world-web/app": ["app@1.0.0", "", {}],
    },
  };
  const head = structuredClone(base);
  head.packages["herdr-world-web/app"]![0] = "app@1.0.1";
  expect(shippedGraphChanged(base, head)).toBe(true);
});
