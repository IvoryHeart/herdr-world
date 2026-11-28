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
import { acquireAllCheckSlots, acquireCheckSlot } from "./check-lock";

const root = fileURLToPath(new URL("../", import.meta.url));
const staticCommands = [
  "features:check",
  "notices:check",
  "check:dead",
  "check:size",
  "check:test-waits",
  "check:commit",
  "typecheck:quick",
  "typecheck:bun",
  "build",
  "build:site",
  "spec:check",
  "help:check",
]
  .map((script) => `run ${script}`)
  .concat("scripts/check-knowledge-map-links.ts");

const staticGroups = {
  build: ["run build"],
  types: ["run typecheck:quick", "run typecheck:bun"],
  repository: staticCommands.filter(
    (command) =>
      !["run build", "run typecheck:quick", "run typecheck:bun"].includes(
        command,
      ),
  ),
};

function exercise(
  args: string[],
  failOn = "",
  paths?: string[],
  incremental = false,
  ciMerge = false,
  extraEnv: Record<string, string> = {},
  inspect?: (directory: string, output: string) => void,
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
    // No command can finish until every static command has started. This
    // detects serialized execution without asserting a machine-speed limit.
    writeFileSync(
      join(directory, "static-probe.ts"),
      `
import { appendFileSync, readFileSync, watch } from "node:fs";
const record = process.env.GATE_COMMANDS!;
const command = process.argv.slice(2).join(" ");
let complete = false;
// Watch notifications may coalesce; make one final observation at the deadline.
const deadline = setTimeout(() => {
  finish();
  if (!complete) process.exit(88);
}, 15000);
const watcher = watch(record, finish);
appendFileSync(record, command + "\\n");
function finish() {
  if (complete || readFileSync(record, "utf8").trim().split("\\n").length !== ${staticCommands.length}) return;
  complete = true;
  watcher.close();
  clearTimeout(deadline);
  console.log("stdout: " + command);
  console.error("stderr: " + command);
  if (process.argv.slice(2).includes(process.env.GATE_FAIL_ON!)) {
    console.error("synthetic violation: " + command);
    process.exitCode = 37;
  }
}
finish();
`,
    );
    writeFileSync(
      join(directory, "bun"),
      '#!/bin/sh\nif [ "$GATE_BARRIER" = 1 ]; then exec "$GATE_REAL_BUN" "$GATE_PROBE" "$@"; fi\nprintf "%s\\n" "$*" >> "$GATE_COMMANDS"\nif [ -n "$GATE_FAIL_ON" ] && { [ "$1" = "$GATE_FAIL_ON" ] || [ "$2" = "$GATE_FAIL_ON" ]; }; then exit 37; fi\n',
      { mode: 0o755 },
    );
    if (paths) {
      const git = (...argv: string[]) =>
        execFileSync("git", argv, { cwd: directory, encoding: "utf8" }).trim();
      git("config", "user.name", "Example");
      git("config", "user.email", "example@example.invalid");
      mkdirSync(join(directory, "verification/coverage"), { recursive: true });
      writeFileSync(
        join(directory, "verification/coverage/_meta.json"),
        '{"schemaVersion":1}',
      );
      mkdirSync(join(directory, "scripts/agent"), { recursive: true });
      if (paths.some((path) => path.startsWith("openspec/")))
        writeFileSync(
          join(directory, "scripts/openspec-feature-map.test.ts"),
          "// runtime OpenSpec directory scan\n",
        );
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
      for (const lane of ["unit", "browser", "quiet", "verification"])
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
      timeout: 20000,
      env: {
        ...process.env,
        CI: "true",
        CHROME_BIN: join(directory, "fixture-chrome"),
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        GATE_COMMANDS: record,
        GATE_REAL_BUN: process.execPath,
        GATE_PROBE: join(directory, "static-probe.ts"),
        GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
        GATE_FAIL_ON: failOn,
        ...extraEnv,
      },
    });
    if (
      result.status !== null &&
      args[0] === "scripts/check-delivery.ts" &&
      result.stdout.includes("[gate]")
    )
      for (const lane of ["unit", "browser", "quiet", "verification"])
        expect(
          readFileSync(join(laneDir, `${lane}.log`), "utf8").includes(
            "stale output",
          ),
        ).toBe(false);
    if (incremental) expect(result.stdout).not.toContain("tooling-only");
    inspect?.(directory, result.stdout + result.stderr);
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
  for (const failOn of [
    "",
    ...staticCommands.map((command) => command.split(" ").at(-1)!),
  ]) {
    const result = exercise(["scripts/check-delivery.ts", "--static"], failOn);
    expect(result.status).toBe(failOn ? 1 : 0);
    expect(result.commands.toSorted()).toEqual(staticCommands.toSorted());
  }
});

test("CI static groups partition every command and retain every failure", () => {
  const scheduled: string[] = [];
  for (const [group, commands] of Object.entries(staticGroups)) {
    for (const failOn of [
      "",
      ...commands.map((command) => command.split(" ").at(-1)!),
    ]) {
      const result = exercise(
        ["scripts/check-delivery.ts", "--static", `--static-group=${group}`],
        failOn,
        undefined,
        false,
        false,
        {},
        (directory, output) => {
          const summary = readFileSync(join(directory, "summary.md"), "utf8");
          const logs = readdirSync(
            join(directory, ".agents/delivery/lanes"),
          ).filter(
            (name) => name.startsWith("static-") && name.endsWith(".log"),
          );
          expect(logs).toHaveLength(commands.length);
          for (const command of staticCommands)
            expect(summary.includes(`\`bun ${command}\``)).toBe(
              commands.includes(command),
            );
          if (failOn) {
            expect(output).toContain("First failure:");
            expect(summary).toContain("failed (exit 37)");
          } else
            expect(summary).toContain(
              `All ${commands.length} static checks passed`,
            );
        },
      );
      expect(result.status).toBe(failOn ? 1 : 0);
      expect(result.commands.toSorted()).toEqual(commands.toSorted());
      if (!failOn) scheduled.push(...result.commands);
    }
  }
  expect(scheduled.toSorted()).toEqual(staticCommands.toSorted());
});

test.each([
  { args: ["--static", "--static-group=typo"] },
  { args: ["--static", "--static-group="] },
  { args: ["--static-group=build"] },
])("invalid static selection fails closed: %j", ({ args }) => {
  const result = exercise(["scripts/check-delivery.ts", ...args]);
  expect(result.status).not.toBe(0);
  expect(result.commands).toEqual([""]);
});

test.each(["", "check:dead"])(
  "static checks overlap, retain separate logs and summarize %s",
  (failOn) => {
    const result = exercise(
      ["scripts/check-delivery.ts", "--static"],
      failOn,
      undefined,
      false,
      false,
      { GATE_BARRIER: "1" },
      (directory, output) => {
        const logs = join(directory, ".agents/delivery/lanes");
        const names = readdirSync(logs).filter(
          (name) => name.startsWith("static-") && name.endsWith(".log"),
        );
        expect(names).toHaveLength(staticCommands.length);
        for (const command of staticCommands) {
          const matches = names
            .map((name) => readFileSync(join(logs, name), "utf8"))
            .filter((log) => log.startsWith(`$ bun ${command}\n`));
          expect(matches).toHaveLength(1);
          expect(matches[0]).toContain(`stdout: ${command}\n`);
          expect(matches[0]).toContain(`stderr: ${command}\n`);
          expect(matches[0].match(/stdout:/g)).toHaveLength(1);
        }
        const summary = readFileSync(join(directory, "summary.md"), "utf8");
        for (const command of staticCommands)
          expect(summary).toContain(`bun ${command}`);
        if (failOn) {
          expect(output).toContain(
            "First failure: static-check-dead (exit 37)",
          );
          expect(output).toContain("synthetic violation: run check:dead");
          expect(summary).toContain(
            "First failure: static-check-dead (exit 37)",
          );
        } else
          expect(summary).toContain(
            `All ${staticCommands.length} static checks passed`,
          );
      },
    );
    expect(result.status).toBe(failOn ? 1 : 0);
    expect(result.commands.toSorted()).toEqual(staticCommands.toSorted());
  },
  25000,
);

test.each([
  "openspec/changes/example/specs/example/spec.md",
  "web/src/example.help.ts",
  "web/public/help/example.png",
  "scripts/file-size-exceptions.json",
])("static guards run for their input %s", (path) => {
  const result = exercise(["scripts/check-delivery.ts"], "", [path]);
  expect(result.status).toBe(0);
  for (const command of [
    "run spec:check",
    "scripts/check-knowledge-map-links.ts",
    "run help:check",
    "run check:size",
  ])
    expect(result.commands).toContain(command);
  if (path.startsWith("openspec/"))
    expect(result.commands).toContain(
      "scripts/run-tests.ts scripts/openspec-feature-map.test.ts --timings=scripts/ci-unit-timings.json --reporter=junit --reporter-outfile=.agents/delivery/timing-unit.xml",
    );
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
  expect(result.commands.toSorted()).toEqual(staticCommands.toSorted());
});

test("tooling scope runs static checks and affected units without heavy lanes", () => {
  const result = exercise(["scripts/check-delivery.ts"], "", [
    "scripts/agent/example.ts",
  ]);
  expect(result.status).toBe(0);
  expect(result.commands).toContain("run check:size");
  expect(result.commands).toContain("run typecheck:quick");
  expect(result.commands).toContain(
    "scripts/run-tests.ts scripts/agent/example.test.ts --timings=scripts/ci-unit-timings.json --reporter=junit --reporter-outfile=.agents/delivery/timing-unit.xml",
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
  const verification = full.commands.indexOf("run verification:gate");
  for (const [index, command] of full.commands.entries())
    if (/run-world-tests|scripts\/run-tests/.test(command))
      expect(index).toBeLessThan(verification);
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
      "scripts/run-tests.ts scripts/agent/example.test.ts scripts/agent/other.test.ts --timings=scripts/ci-unit-timings.json --reporter=junit --reporter-outfile=.agents/delivery/timing-unit.xml",
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
    "scripts/run-tests.ts scripts/agent/example.test.ts scripts/agent/other.test.ts --timings=scripts/ci-unit-timings.json --reporter=junit --reporter-outfile=.agents/delivery/timing-unit.xml",
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
    "scripts/run-browser-tests.ts web/src/uiScale.test.ts --parallel=4 --max-concurrency=12 --reporter=junit --reporter-outfile=.agents/delivery/timing-quiet.xml",
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
    expect(result.commands.toSorted()).toEqual(staticCommands.toSorted());
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
      "scripts/run-browser-tests.ts web/src/uiScale.test.ts --parallel=4 --max-concurrency=12 --reporter=junit --reporter-outfile=.agents/delivery/timing-quiet.xml",
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
