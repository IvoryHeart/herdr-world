import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireAllCheckSlots, acquireCheckSlot } from "./check-lock";

const root = fileURLToPath(new URL("../", import.meta.url));

function exercise(
  args: string[],
  failOn = "",
  paths?: string[],
  incremental = false,
  ciMerge = false,
  extraEnv: Record<string, string> = {},
) {
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
    if (paths) {
      const git = (...argv: string[]) =>
        execFileSync("git", argv, { cwd: directory, encoding: "utf8" }).trim();
      git("config", "user.name", "Example");
      git("config", "user.email", "example@example.invalid");
      mkdirSync(join(directory, "verification"));
      writeFileSync(
        join(directory, "verification/coverage.json"),
        '{"areas":[]}',
      );
      mkdirSync(join(directory, "scripts/agent"), { recursive: true });
      writeFileSync(
        join(directory, "scripts/agent/example.ts"),
        "export const value = 1;\n",
      );
      writeFileSync(
        join(directory, "scripts/agent/example.test.ts"),
        'import { value } from "./example";\n',
      );
      writeFileSync(
        join(directory, "scripts/agent/other.test.ts"),
        "// another agent regression\n",
      );
      mkdirSync(join(directory, "web/src"), { recursive: true });
      writeFileSync(
        join(directory, "web/src/uiScale.test.ts"),
        "// " + ["CHROME", "BIN"].join("_") + " browser fixture\n",
      );
      git("add", ".");
      git("commit", "-qm", "base");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      for (const path of paths) {
        mkdirSync(join(directory, path, ".."), { recursive: true });
        writeFileSync(join(directory, path), "// changed\n");
      }
      git("add", ".");
      git("commit", "-qm", "change");
      if (ciMerge) {
        const topic = git("rev-parse", "HEAD");
        git("checkout", "-q", "--detach", "origin/main");
        writeFileSync(join(directory, "main-only.md"), "main advance\n");
        git("add", ".");
        git("commit", "-qm", "main advance");
        const baseSha = git("rev-parse", "HEAD");
        git("merge", "-q", "--no-ff", "--no-edit", topic);
        expect(
          git("rev-list", "--parents", "-n", "1", "HEAD").split(" "),
        ).toHaveLength(3);
        args = [...args, `--scope-base=${baseSha}`];
      }
      if (incremental) {
        const remote = git("rev-parse", "HEAD");
        writeFileSync(
          join(directory, "scripts/agent/example.ts"),
          "export const value = 2;\n",
        );
        git("add", ".");
        git("commit", "-qm", "agent follow-up");
        args = [...args, `--base=${remote}`];
      }
    }
    const laneDir = join(directory, ".agents/delivery/lanes");
    if (args[0] === "scripts/check-delivery.ts") {
      mkdirSync(laneDir, { recursive: true });
      for (const lane of ["static", "unit", "browser", "quiet", "verification"])
        writeFileSync(
          join(laneDir, `${lane}.log`),
          "stale output from previous run\n".repeat(1000),
        );
    }
    const command =
      args[0] === "scripts/check-delivery.ts"
        ? [join(root, args[0]), ...args.slice(1)]
        : args;
    const result = spawnSync(process.execPath, command, {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        CI: "true",
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        GATE_COMMANDS: record,
        GATE_FAIL_ON: failOn,
        ...extraEnv,
      },
    });
    if (result.status !== null && args[0] === "scripts/check-delivery.ts")
      for (const lane of ["static", "unit", "browser", "quiet", "verification"])
        expect(
          readFileSync(join(laneDir, `${lane}.log`), "utf8"),
        ).not.toContain("stale output");
    if (incremental) expect(result.stdout).not.toContain("tooling-only");
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
    commands: ["run check:agents", "run format:check", "run lint"],
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

test("a changed gate always runs CI static checks and blocks size failures before tests", () => {
  const result = exercise(["scripts/check-delivery.ts"], "check:size", [
    "scripts/agent/example.ts",
  ]);
  expect(result.status).toBe(1);
  expect(result.commands).toEqual([
    "run notices:check",
    "run changelog:check",
    "run check:size",
  ]);
});

test("tooling scope runs static checks and affected units without heavy lanes", () => {
  const result = exercise(["scripts/check-delivery.ts"], "", [
    "scripts/agent/example.ts",
  ]);
  expect(result.status).toBe(0);
  expect(result.commands).toContain("run check:size");
  expect(result.commands).toContain("run typecheck:quick");
  expect(result.commands).toContain(
    "scripts/run-tests.ts scripts/agent/example.test.ts",
  );
  expect(
    result.commands.some((cmd) =>
      /run-world-tests|verification:gate/.test(cmd),
    ),
  ).toBe(false);
});

test("tooling classification includes earlier PR commits on an incremental push", () => {
  const result = exercise(
    ["scripts/check-delivery.ts"],
    "",
    ["package.json"],
    true,
  );
  expect(result.status).toBe(0);
  // The helper checks that the earlier configuration commit forbids tooling
  // scope, even though the incremental diff contains only an agent module.
  const full = exercise(
    ["scripts/check-delivery.ts", "--full"],
    "",
    ["package.json"],
    true,
  );
  expect(full.commands).toContain("run verification:gate");
  expect(
    full.commands.some((cmd) => cmd.startsWith("scripts/run-world-tests.ts")),
  ).toBe(true);
});

test("an uncovered agent module runs the entire agent test inventory without heavy lanes", () => {
  for (const ciMerge of [false, true]) {
    const result = exercise(
      ["scripts/check-delivery.ts"],
      "",
      ["scripts/agent/untested.ts"],
      false,
      ciMerge,
    );
    expect(result.status).toBe(0);
    expect(result.commands).toContain("run check:size");
    expect(result.commands).toContain("run typecheck:quick");
    expect(result.commands).toContain(
      "scripts/run-tests.ts scripts/agent/example.test.ts scripts/agent/other.test.ts",
    );
    expect(
      result.commands.some((cmd) =>
        /run-world-tests|verification:gate/.test(cmd),
      ),
    ).toBe(false);
  }
});

test("pre-push keeps all non-browser units for gate changes and leaves heavy suites to CI", () => {
  const result = exercise(["scripts/check-delivery.ts"], "", ["package.json"]);
  expect(result.status).toBe(0);
  expect(result.commands).toContain(
    "scripts/run-tests.ts scripts/agent/example.test.ts scripts/agent/other.test.ts",
  );
  expect(
    result.commands.some((cmd) =>
      /uiScale|run-world-tests|verification:gate/.test(cmd),
    ),
  ).toBe(false);
  const full = exercise(["scripts/check-delivery.ts", "--full"], "", [
    "package.json",
  ]);
  expect(full.status).toBe(0);
  expect(full.commands).toContain(
    "scripts/run-tests.ts web/src/uiScale.test.ts --parallel=2",
  );
  expect(full.commands).toContain("run verification:gate");
  expect(
    full.commands.some((cmd) => cmd.startsWith("scripts/run-world-tests.ts")),
  ).toBe(true);
});

test("static failures report while all heavy check slots are held, regardless of a disk floor", async () => {
  const runtime = mkdtempSync(join(tmpdir(), "static-queue-"));
  const release = await acquireAllCheckSlots({
    lane: "heavy fixture",
    dir: join(runtime, "herdr-world-checks"),
    env: {},
  });
  try {
    const result = exercise(
      ["scripts/check-delivery.ts", "--static"],
      "check:size",
      undefined,
      false,
      false,
      {
        CI: "",
        HERDR_WORLD_CHECK_LOCK: "",
        XDG_RUNTIME_DIR: runtime,
        HERDR_WORLD_MIN_FREE_GB: "999999999",
      },
    );
    expect(result.status).toBe(1);
    expect(result.commands).toEqual([
      "run notices:check",
      "run changelog:check",
      "run check:size",
    ]);
  } finally {
    release();
    rmSync(runtime, { recursive: true, force: true });
  }
});

test("Chrome lanes share the browser slot while unit and verification work hold their slots", async () => {
  const runtime = mkdtempSync(join(tmpdir(), "chrome-queue-"));
  const options = {
    lane: "heavy fixture",
    dir: join(runtime, "herdr-world-checks"),
    env: {},
  };
  const unit = await acquireCheckSlot("light", options);
  const verification = await acquireCheckSlot("verification", options);
  try {
    const result = exercise(
      ["scripts/check-delivery.ts", "--browser"],
      "",
      ["package.json"],
      false,
      false,
      {
        CI: "",
        HERDR_WORLD_CHECK_LOCK: "",
        XDG_RUNTIME_DIR: runtime,
      },
    );
    expect(result.status).toBe(0);
    expect(result.commands).toContain(
      "scripts/run-tests.ts web/src/uiScale.test.ts --parallel=2",
    );
    expect(
      result.commands.some((cmd) => /verification:gate|^run /.test(cmd)),
    ).toBe(false);
  } finally {
    verification();
    unit();
    rmSync(runtime, { recursive: true, force: true });
  }
});
