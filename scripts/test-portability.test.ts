import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { portabilityProblems } from "./test-portability";

test("#900: lint rejects GNU-only renamed sleep before CI reaches uutils", () => {
  for (const source of [
    'symlinkSync(Bun.which("sleep")!, odd);',
    'const binary = Bun.which("sleep")!; symlinkSync(binary, join(root,"a) b c"));',
    'fs.symlinkSync("/usr/bin/sleep", odd);',
    'await fs.promises.symlink("/bin/sleep", odd);',
    'copyFileSync("/usr/bin/sleep", join(root, "probe"));',
  ])
    expect(portabilityProblems(source)[0]).toContain(
      "renamed coreutils 'sleep'",
    );
});

test("same-name links and the current shell process-name fixture are portable", () => {
  expect(
    portabilityProblems('symlinkSync(Bun.which("sleep")!, join(bin,"sleep"));'),
  ).toEqual([]);
  expect(portabilityProblems('symlinkSync(Bun.which("sh")!, odd);')).toEqual(
    [],
  );
  expect(
    portabilityProblems(
      readFileSync(
        new URL(
          "../server/src/agent/claude-process-session.test.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  ).toEqual([]);
});
