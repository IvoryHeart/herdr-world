import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("pre-push runs the full check and blocks a failed check", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  const argsPath = join(root, "bun-args");
  const envPath = join(root, "bun-env");
  const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(
    join(root, "bun"),
    '#!/bin/sh\nprintf "%s\\n" "$*" > "$HOOK_ARGS_FILE"\nprintf "%s|%s|%s\\n" "${GIT_DIR:-}" "${GIT_WORK_TREE:-}" "${GIT_INDEX_FILE:-}" > "$HOOK_ENV_FILE"\nprintf "synthetic check failure\\n" >&2\nexit "$HOOK_EXIT_CODE"\n',
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
    expect(success.stderr).toBe("");
    expect(readFileSync(argsPath, "utf8")).toBe("run check\n");
    expect(readFileSync(envPath, "utf8")).toBe("||\n");

    const failure = run(37);
    expect(failure.status).toBe(37);
    expect(failure.stderr).toContain("synthetic check failure");
    expect(readFileSync(argsPath, "utf8")).toBe("run check\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
