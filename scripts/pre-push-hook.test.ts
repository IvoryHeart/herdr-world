import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("branch, tag and multi-ref pushes run only read-only formatting and privacy", () => {
  const root = mkdtempSync(join(tmpdir(), "world-push-"));
  const hook = resolve(".githooks/pre-push");
  try {
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(
      join(root, "bun"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = run ]; then exit "\${FORMAT_EXIT:-0}"; fi
cp "$3" "$REFS"
exit "\${PRIVACY_EXIT:-0}"
`,
      { mode: 0o755 },
    );
    const refs = [
      "refs/heads/example a refs/heads/example b\n",
      "refs/tags/v1.0.0 a refs/tags/v1.0.0 b\n",
      "refs/heads/one a refs/heads/one b\nrefs/heads/two c refs/heads/two d\n",
    ];
    for (const input of refs) {
      writeFileSync(join(root, "calls"), "");
      const result = spawnSync("sh", [hook], {
        cwd: root,
        input,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          CALLS: join(root, "calls"),
          REFS: join(root, "refs"),
          // The old escape hatch must not restore a full local gate.
          HERDR_WORLD_PREPUSH: "full",
        },
      });
      expect(result.status).toBe(0);
      const calls = readFileSync(join(root, "calls"), "utf8")
        .split("\n")
        .filter(Boolean);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe("run format:check");
      expect(calls[1]).toStartWith("scripts/check-privacy.ts --pre-push ");
      expect(readFileSync(join(root, "refs"), "utf8")).toBe(input);
    }
    for (const [FORMAT_EXIT, PRIVACY_EXIT, code] of [
      ["23", "0", 23],
      ["0", "24", 24],
    ] as const) {
      const result = spawnSync("sh", [hook], {
        cwd: root,
        input: refs[0],
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          CALLS: join(root, "calls"),
          REFS: join(root, "refs"),
          FORMAT_EXIT,
          PRIVACY_EXIT,
        },
      });
      expect(result.status).toBe(code);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
