import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Step = { name?: string; run?: string; uses?: string };
const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/pages.yml", import.meta.url),
  ).text(),
) as {
  on: Record<string, unknown>;
  jobs: {
    build: { steps: Step[] };
    deploy: { needs: string; steps: Step[] };
  };
};
const steps = workflow.jobs.build.steps;
const gateIndex = steps.findIndex(
  (step) => step.name === "Verify live Herdr World installer",
);
const gate = steps[gateIndex]?.run ?? "";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Pages deploys on main pushes or manual dispatch and checks installer availability", async () => {
  expect(Object.keys(workflow.on).sort()).toEqual([
    "push",
    "workflow_dispatch",
  ]);
  expect(workflow.on.push).toEqual({
    branches: ["main"],
    paths: [
      "site/**",
      "docs/TUTORIAL.md",
      "docs/images/**",
      "scripts/build-pages.ts",
      "scripts/pages-content.ts",
      "scripts/pages-*.test.ts",
      ".github/workflows/pages.yml",
    ],
  });
  expect(gateIndex).toBeGreaterThan(-1);
  expect(gateIndex).toBeLessThan(
    steps.findIndex((step) =>
      step.uses?.startsWith("actions/upload-pages-artifact@"),
    ),
  );
  expect(workflow.jobs.deploy.needs).toBe("build");
  expect(
    workflow.jobs.deploy.steps.some((step) =>
      step.uses?.startsWith("actions/deploy-pages@"),
    ),
  ).toBe(true);
  const url = gate.match(/https:\/\/\S+\/install-herdr-world\.sh/)?.[0];
  expect(url).toBe(
    "https://github.com/IvoryHeart/herdr-world/releases/latest/download/install-herdr-world.sh",
  );
  for (const path of [
    "../site/index.html",
    "../site/main.js",
    "../README.md",
    "../docs/DEPLOYMENT.md",
  ]) {
    expect(await Bun.file(new URL(path, import.meta.url)).text()).toContain(
      url!,
    );
  }
});

test("Pages installer probe requires HTTP 200 over HTTPS and fails closed on curl errors", () => {
  const root = mkdtempSync(join(tmpdir(), "pages-gate-test-"));
  roots.push(root);
  writeFileSync(
    join(root, "curl"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$PROBE_ARGS"\nprintf "%s" "$PROBE_STATUS"\nexit "$PROBE_EXIT"\n',
    { mode: 0o755 },
  );
  for (const [exitCode, status] of [
    [0, 200],
    [0, 204],
    [0, 302],
    [22, 404],
    [22, 500],
    [6, 0],
    [28, 200],
    [60, 0],
  ]) {
    const result = Bun.spawnSync(["sh", "-c", gate], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        PROBE_ARGS: join(root, "args"),
        PROBE_EXIT: String(exitCode),
        PROBE_STATUS: String(status),
      },
    });
    const available = exitCode === 0 && status === 200;
    expect(result.exitCode).toBe(available ? 0 : 1);
    if (!available) {
      expect(result.stderr.toString()).toContain(
        "Publish a Herdr World release as Latest",
      );
    }
  }
  const args = readFileSync(join(root, "args"), "utf8").trim().split("\n");
  for (const flag of ["--fail", "--location", "--silent", "--show-error"]) {
    expect(args).toContain(flag);
  }
  expect(args[args.indexOf("--proto") + 1]).toBe("=https");
  expect(args[args.indexOf("--proto-redir") + 1]).toBe("=https");
  expect(args[args.indexOf("--connect-timeout") + 1]).toBe("10");
  expect(args[args.indexOf("--max-time") + 1]).toBe("60");
  expect(args[args.indexOf("--write-out") + 1]).toBe("%{http_code}");
  expect(args.at(-1)).toEndWith(
    "/releases/latest/download/install-herdr-world.sh",
  );
});

test("only a fully published stable release dispatches Pages from main", async () => {
  const release = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/release.yml", import.meta.url),
    ).text(),
  ) as {
    jobs: Record<
      string,
      {
        if?: string;
        needs?: string[];
        permissions?: Record<string, string>;
        steps?: Array<Step & { env?: Record<string, string> }>;
      }
    >;
  };
  const handoff = release.jobs["deploy-pages"];
  expect(handoff).toBeDefined();
  expect(handoff.needs).toEqual(["publish", "npm-publish", "homebrew-pr"]);
  expect(handoff.if).toBe(
    "startsWith(github.ref, 'refs/tags/v') && !contains(github.ref_name, '-rc.')",
  );
  expect(handoff.permissions).toEqual({ actions: "write" });
  expect(handoff.steps).toHaveLength(1);
  expect(handoff.steps![0].env).toEqual({
    GH_TOKEN: "${{ github.token }}",
    GH_REPO: "${{ github.repository }}",
  });
  expect(handoff.steps![0].run).toBe("gh workflow run pages.yml --ref main");
});
