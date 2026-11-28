import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
type Step = {
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  with?: Record<string, unknown>;
};
test("privacy scans every PR change and metadata edit inside the existing scope job", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  ) as {
    on: { pull_request: { types: string[] }; workflow_dispatch: unknown };
    permissions: { contents: string };
    jobs: Record<
      string,
      { steps: Step[]; if?: string; "continue-on-error"?: boolean }
    >;
  };
  expect(existsSync(join(root, ".github/workflows/privacy.yml"))).toBe(false);
  expect(workflow.on.pull_request.types).toEqual(
    expect.arrayContaining(["opened", "synchronize", "reopened", "edited"]),
  );
  expect(workflow.on).toHaveProperty("workflow_dispatch");
  expect(workflow.permissions.contents).toBe("read");
  expect(workflow.jobs["validation-scope"]!.if).toContain(
    "github.event.pull_request.state == 'open'",
  );
  expect(
    workflow.jobs["validation-scope"]!["continue-on-error"],
  ).toBeUndefined();
  const steps = workflow.jobs["validation-scope"]!.steps;
  const checkout = steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout?.with).toMatchObject({
    "fetch-depth": 0,
    "persist-credentials": false,
  });
  const scan = steps.find((step) => step.run?.includes("check-privacy.ts"))!;
  expect(scan).toBeDefined();
  expect(scan.if).toBeUndefined();
  expect(scan["continue-on-error"]).toBeUndefined();
  expect(steps.indexOf(scan)).toBeLessThan(
    steps.findIndex((step) => step.run?.includes("ci-reuse-full-check.ts")),
  );
  for (const event of [
    "pull_request",
    "workflow_dispatch",
    "merge_group",
    "push",
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "privacy-dispatch-"));
    try {
      writeFileSync(join(directory, "bun"), '#!/bin/sh\nprintf "%s" "$*"\n', {
        mode: 0o755,
      });
      const result = spawnSync("bash", ["-e", "-c", scan.run!], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GITHUB_EVENT_NAME: event,
          GITHUB_EVENT_PATH: "event.json",
        },
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        event === "pull_request"
          ? "scripts/check-privacy.ts --event event.json"
          : "run check:privacy",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("ignore rules cover nested credentials, databases, runtimes and owner research", () => {
  const paths = [
    "password",
    "nested/password",
    "session-secret.json",
    "nested/session-secret.json",
    "world.sqlite",
    "nested/world.sqlite-wal",
    "nested/world.sqlite-shm",
    "runtime-example/state",
    "nested/runtime-example/state",
    "report.local.md",
    "nested/report.local.md",
    "research-local/concept.png",
  ];
  const ignored = execFileSync(
    "git",
    ["check-ignore", "--no-index", "--stdin"],
    {
      cwd: root,
      input: paths.join("\n") + "\n",
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n");
  expect(ignored).toEqual(paths);
  for (const path of [
    "openspec/specs/runtime-federation/spec.md",
    "openspec/changes/new-change/specs/runtime-federation/spec.md",
  ]) {
    const checked = spawnSync("git", ["check-ignore", "--no-index", path], {
      cwd: root,
    });
    expect(checked.status).toBe(1);
  }
});

test("the real pre-push hook blocks private refs before policy and delivery commands", () => {
  const directory = mkdtempSync(join(tmpdir(), "privacy-hook-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    writeFileSync(join(directory, "report.md"), "Safe\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    const sensitive = ["", "home", "operator", "report.md"].join("/");
    writeFileSync(join(directory, "report.md"), sensitive + "\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture");
    const bad = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", base);
    mkdirSync(join(directory, "bin"));
    writeFileSync(
      join(directory, "bin/bun"),
      '#!/bin/sh\nif [ "$1" = scripts/check-privacy.ts ]; then shift; exec "$REAL_BUN" "$PRIVACY_SCRIPT" "$@"; fi\nprintf "%s\\n" "$*" >> "$OTHER_COMMANDS"\n',
      { mode: 0o755 },
    );
    const result = spawnSync("sh", [join(root, ".githooks/pre-push")], {
      cwd: directory,
      encoding: "utf8",
      input: `refs/heads/main ${base} refs/heads/main ${base}\nrefs/heads/topic ${bad} refs/heads/topic ${"0".repeat(40)}\n`,
      env: {
        ...process.env,
        PATH: `${join(directory, "bin")}:${process.env.PATH}`,
        REAL_BUN: process.execPath,
        PRIVACY_SCRIPT: join(root, "scripts/check-privacy.ts"),
        OTHER_COMMANDS: join(directory, "other-commands"),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("privacy/home-path");
    expect(result.stderr).not.toContain(sensitive);
    expect(readFileSync(join(directory, "other-commands"), "utf8").trim()).toBe(
      "run format:check",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
