import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProcessExitError,
  runProcess,
  runProcessWithCodeTimeout,
} from "./process-utils";

test.each([7, 255])(
  "process exit %i preserves structured facts and the original diagnostic",
  async (code) => {
    const stdout = "synthetic stdout\n";
    const stderr = "synthetic stderr\n";
    let failure: unknown;
    try {
      await runProcess([
        process.execPath,
        "-e",
        `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${code});`,
      ]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ProcessExitError);
    const error = failure as ProcessExitError;
    expect(error.message).toBe(
      `${process.execPath} exited ${code}: synthetic stderr`,
    );
    expect(error.exitCode).toBe(code);
    expect(error.stdout).toBe(stdout);
    expect(error.stderr).toBe(stderr);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "ProcessExitError",
    });
  },
);

test("process success retains both output streams without classifying diagnostics", async () => {
  expect(
    await runProcess([
      process.execPath,
      "-e",
      'process.stdout.write("/synthetic/home"); process.stderr.write("Connection timed out");',
    ]),
  ).toEqual({ stdout: "/synthetic/home", stderr: "Connection timed out" });
});

test("native spawning preserves cwd, environment and literal arguments without a shell on PATH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roamgate process ' "));
  const literal = "space ' quote \" & $HOME; $(echo injected)";
  try {
    const result = await runProcessWithCodeTimeout(
      [
        process.execPath,
        "-e",
        "console.log(JSON.stringify({cwd:process.cwd(), value:process.env.HERDR_WORLD_TEST_VALUE, args:process.argv.slice(1)}))",
        literal,
      ],
      5000,
      {
        cwd: directory,
        env: { ...process.env, PATH: "", HERDR_WORLD_TEST_VALUE: literal },
      },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      cwd: await realpath(directory),
      value: literal,
      args: [literal],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
