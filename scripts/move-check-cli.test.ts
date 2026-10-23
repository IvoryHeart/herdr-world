import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtures = [
  [
    "trailing comment brace",
    'import setup from "./setup"; // {\nsetup.configure("safe");\n',
  ],
  [
    "block comment brace",
    'import setup from "./setup"; /* { */\nsetup.configure("safe");\n',
  ],
  [
    "module string brace",
    'import setup from "./{";\nsetup.configure("safe");\n',
  ],
  [
    "shared import line",
    'import setup from "./setup"; setup.configure("safe");\n',
  ],
  [
    "shared export line",
    'const setup = {};\nexport { setup }; configure("safe");\n',
  ],
  [
    "bare dynamic import callback",
    'import("./worker").then(({ start }) => {\n  start("safe");\n});\n',
  ],
  ["bare dynamic import argument", 'import("./safe");\n'],
] as const;

for (const [name, before] of fixtures) {
  test(`CLI rejects executable edits after ${name}`, () => {
    const root = mkdtempSync(join(tmpdir(), "move-check-cli-"));
    try {
      const hooks = join(root, "hooks");
      mkdirSync(hooks);
      const git = (...args: string[]) => {
        const result = Bun.spawnSync(
          [
            "git",
            "-c",
            `core.hooksPath=${hooks}`,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            ...args,
          ],
          { cwd: root, stdout: "pipe", stderr: "pipe" },
        );
        expect(result.exitCode).toBe(0);
        return result.stdout.toString().trim();
      };
      git("init", "--quiet");
      writeFileSync(join(root, "entry.ts"), before);
      git("add", "entry.ts");
      git("commit", "--quiet", "-m", "Fixture before");
      const base = git("rev-parse", "HEAD");
      writeFileSync(join(root, "entry.ts"), before.replace("safe", "unsafe"));
      git("commit", "--quiet", "-am", "Fixture after");
      const result = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "move-check.ts"), base],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      expect(result.exitCode).toBe(1);
      const errors = result.stderr.toString();
      expect(errors).toContain("Removed and not moved (1)");
      expect(errors).toContain("Added without a moved original (1)");
      expect(errors).toContain("safe");
      expect(errors).toContain("unsafe");
    } finally {
      rmSync(root, { recursive: true });
    }
  });
}
