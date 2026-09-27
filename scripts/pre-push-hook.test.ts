import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("pre-push runs the full check and blocks a failed check", () => {
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
    expect(success.stderr).toMatch(/pre-push: bun run check passed in \d+s/);
    expect(readdirSync(deliveryDir)).toEqual(["pre-push.tsv"]);
    expect(readFileSync(reportPath, "utf8")).toMatch(/\t0\t\d+\n$/);
    expect(readFileSync(argsPath, "utf8")).toBe("run check\n");
    expect(readFileSync(envPath, "utf8")).toBe("||\n");

    const failure = run(37);
    expect(failure.status).toBe(37);
    expect(failure.stderr).toMatch(
      /pre-push: bun run check failed \(exit 37, \d+s\)/,
    );
    expect(failure.stderr).toContain("(fail) synthetic browser regression");
    const logPath = failure.stderr.match(/Full log: (.+)\n/)?.[1];
    expect(logPath).toBeDefined();
    expect(readFileSync(logPath!, "utf8")).toContain(
      "synthetic early diagnostic and stack",
    );
    expect(readFileSync(reportPath, "utf8")).toMatch(/\t37\t\d+\n$/);
    expect(readFileSync(argsPath, "utf8")).toBe("run check\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
