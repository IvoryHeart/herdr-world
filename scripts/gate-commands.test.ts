import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function exercise(args: string[], failOn = "") {
  const directory = mkdtempSync(join(tmpdir(), "gate-commands-"));
  const record = join(directory, "commands");
  try {
    // The real runner writes lane logs under cwd; isolate them from a parent
    // delivery gate and give its static selection an empty tracked inventory.
    expect(spawnSync("git", ["init", "-q", directory]).status).toBe(0);
    writeFileSync(
      join(directory, "package.json"),
      readFileSync(join(root, "package.json")),
    );
    writeFileSync(record, "");
    writeFileSync(
      join(directory, "bun"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GATE_COMMANDS"\nif [ "$2" = "$GATE_FAIL_ON" ]; then exit 37; fi\n',
      { mode: 0o755 },
    );
    const command =
      args[0] === "scripts/check-delivery.ts"
        ? [join(root, args[0]), ...args.slice(1)]
        : args;
    const result = spawnSync(process.execPath, command, {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        GATE_COMMANDS: record,
        GATE_FAIL_ON: failOn,
      },
    });
    return {
      status: result.status,
      commands: readFileSync(record, "utf8").trim().split("\n"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("repository validation delegates to the static lane before running tests", () => {
  expect(exercise(["run", "check"])).toEqual({
    status: 0,
    commands: ["run check:static", "run test"],
  });
  expect(exercise(["run", "check"], "check:static")).toEqual({
    status: 37,
    commands: ["run check:static"],
  });
});

test("the static lane retains all checks and builds production assets once", () => {
  const commands = [
    "notices:check",
    "changelog:check",
    "check:size",
    "check:commit",
    "typecheck:quick",
    "typecheck:bun",
    "build",
    "build:site",
    "spec:check",
  ].map((script) => `run ${script}`);
  expect(exercise(["scripts/check-delivery.ts", "--static"])).toEqual({
    status: 0,
    commands,
  });
  expect(
    exercise(["scripts/check-delivery.ts", "--static"], "typecheck:quick"),
  ).toEqual({ status: 1, commands: commands.slice(0, 5) });
});

test("the commit guard and source validation keep distinct acceptance boundaries", () => {
  expect(exercise(["run", "check:commit"])).toEqual({
    status: 0,
    commands: ["run format:check", "run lint"],
  });
  expect(exercise(["run", "check:source"])).toEqual({
    status: 0,
    commands: ["run check:commit", "run typecheck", "run test"],
  });
  expect(exercise(["run", "check:source"], "check:commit")).toEqual({
    status: 37,
    commands: ["run check:commit"],
  });
});
