import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("pre-push checks what changed and blocks a failed check", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  const argsPath = join(root, "bun-args");
  const envPath = join(root, "bun-env");
  const deliveryDir = join(root, ".agents", "delivery");
  const reportPath = join(deliveryDir, "pre-push.tsv");
  const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(
    join(root, "bun"),
    '#!/bin/sh\nprintf "%s\\n" "$*" > "$HOOK_ARGS_FILE"\nprintf "%s|%s|%s\\n" "${GIT_DIR:-}" "${GIT_WORK_TREE:-}" "${GIT_INDEX_FILE:-}" > "$HOOK_ENV_FILE"\nprintf "synthetic early diagnostic and stack\\n" >&2\nprintf "(fail) synthetic browser regression\\n" >&2\ni=0\nwhile [ "$i" -lt 100 ]; do\n  printf "filler %s\\n" "$i" >&2\n  i=$((i + 1))\ndone\nexit "$HOOK_EXIT_CODE"\n',
    { mode: 0o755 },
  );

  try {
    const run = (exitCode: number) =>
      spawnSync("sh", [hook], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ""}`,
          HOOK_ARGS_FILE: argsPath,
          HOOK_ENV_FILE: envPath,
          HOOK_EXIT_CODE: String(exitCode),
          GIT_DIR: join(root, ".git"),
          GIT_WORK_TREE: root,
          GIT_INDEX_FILE: join(root, "foreign-index"),
        },
      });

    const success = run(0);
    expect(success.status).toBe(0);
    expect(success.stdout).toBe("");
    expect(success.stderr).toMatch(
      /pre-push: bun run check:changed passed in \d+s/,
    );
    expect(readdirSync(deliveryDir)).toEqual(["pre-push.tsv"]);
    expect(readFileSync(reportPath, "utf8")).toMatch(/\t0\t\d+\tchanged\n$/);
    // No pushed ref to compare with: the gate compares with main itself.
    expect(readFileSync(argsPath, "utf8")).toBe("run check:changed\n");
    expect(readFileSync(envPath, "utf8")).toBe("||\n");

    const failure = run(37);
    expect(failure.status).toBe(37);
    expect(failure.stderr).toMatch(
      /pre-push: bun run check:changed failed \(exit 37, \d+s\)/,
    );
    expect(failure.stderr).toContain("(fail) synthetic browser regression");
    const logPath = failure.stderr.match(/Full log: (.+)\n/)?.[1];
    expect(logPath).toBeDefined();
    expect(readFileSync(logPath!, "utf8")).toContain(
      "synthetic early diagnostic and stack",
    );
    expect(readFileSync(reportPath, "utf8")).toMatch(/\t37\t\d+\tchanged\n$/);
    expect(readFileSync(argsPath, "utf8")).toBe("run check:changed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-push compares with the pushed branch, and uses the docs gate only after a code gate", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-docs-"));
  const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
  const argsPath = join(root, "bun-args");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "example@example.invalid");
    git("config", "user.name", "Example");
    writeFileSync(join(root, "README.md"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(
      join(root, "bun"),
      '#!/bin/sh\nprintf "%s\\n" "$*" > "$HOOK_ARGS_FILE"\nexit "$HOOK_EXIT_CODE"\n',
      { mode: 0o755 },
    );
    const run = (
      local: string,
      remote: string,
      exitCode = 0,
      extra: Record<string, string> = {},
    ) =>
      spawnSync("sh", [hook], {
        cwd: root,
        input: `refs/heads/example ${local} refs/heads/example ${remote}\n`,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ""}`,
          HOOK_ARGS_FILE: argsPath,
          HOOK_EXIT_CODE: String(exitCode),
          ...extra,
        },
      });

    // A new branch: no remote commit to compare with.
    expect(run(base, "0".repeat(40)).status).toBe(0);
    expect(readFileSync(argsPath, "utf8")).toBe("run check:changed\n");
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "guide.md"), "updated\n");
    git("add", "docs/guide.md");
    git("commit", "-qm", "docs");
    const docs = git("rev-parse", "HEAD");
    expect(run(docs, base, 37).status).toBe(37);
    expect(readFileSync(argsPath, "utf8")).toBe("run check:docs\n");
    expect(run(docs, base).status).toBe(0);
    expect(readFileSync(argsPath, "utf8")).toBe("run check:docs\n");
    for (const path of [
      "verification/contracts/runtime-leases.md",
      "openspec/specs/runtime-federation/spec.md",
      "AGENTS.md",
      "CONTRIBUTING.md",
    ]) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), "changed evidence contract\n");
      git("add", path);
      git("commit", "-qm", "contract");
      writeFileSync(
        join(root, ".agents/delivery/pre-push.tsv"),
        `synthetic\t${base}\t0\t0\tfull\n`,
      );
      expect(run(git("rev-parse", "HEAD"), docs).status).toBe(0);
      expect(readFileSync(argsPath, "utf8")).toBe(
        `run check:changed --base=${docs}\n`,
      );
    }
    writeFileSync(join(root, "code.ts"), "export const value = 1;\n");
    git("add", "code.ts");
    git("commit", "-qm", "code");
    const code = git("rev-parse", "HEAD");
    expect(run(code, docs).status).toBe(0);
    expect(readFileSync(argsPath, "utf8")).toBe(
      `run check:changed --base=${docs}\n`,
    );
    // The owner's override runs the full gate here too.
    expect(run(code, docs, 0, { HERDR_WORLD_PREPUSH: "full" }).status).toBe(0);
    expect(readFileSync(argsPath, "utf8")).toBe("run check:delivery\n");
    // A remote commit that is not an ancestor gives no base.
    expect(run(code, "f".repeat(40)).status).toBe(0);
    expect(readFileSync(argsPath, "utf8")).toBe("run check:changed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
