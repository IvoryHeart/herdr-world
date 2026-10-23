import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXIT_FAILURE, EXIT_OK } from "./command";
import { createUpdateCommand, rollbackCommand } from "./update";
import { createTestCli, type TestCli } from "./test-context";

let cli: TestCli;
afterEach(() => cli?.cleanup());

const manifest = (version: string) =>
  JSON.stringify({
    schema: 1,
    name: "herdr-world",
    version,
    platform: "linux-x64",
    archive: "herdr-world-linux-x64.tar.xz",
    sha256: "a".repeat(64),
  });

function fakeProcess(version: string, installCode = 0) {
  const calls: string[][] = [];
  return {
    calls,
    runProcess: async (argv: string[]) => {
      calls.push(argv);
      return argv[0] === "curl"
        ? { code: 0, stdout: manifest(version), stderr: "" }
        : {
            code: installCode,
            stdout: "",
            stderr: installCode ? "checksum mismatch" : "",
          };
    },
  };
}

describe("herdr-world update", () => {
  test("--check compares against the latest manifest", async () => {
    cli = createTestCli();
    const fake = fakeProcess("1.3.0");
    const code = await createUpdateCommand(fake).run(
      ["--check", "--json"],
      cli.context,
    );
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(cli.output.join("\n"))).toEqual({
      current_version: "1.2.3",
      latest_version: "1.3.0",
      update_available: true,
      platform: "linux-x64",
    });
    expect(fake.calls[0]).toContain(
      "https://github.com/IvoryHeart/herdr-world/releases/latest/download/herdr-world-linux-x64.update.json",
    );
  });

  test("uses a mirror from the service config", async () => {
    cli = createTestCli();
    cli.writeConfig(
      "HERDR_WORLD_UPDATE_BASE_URL=https://mirror.example/herdr-world/\n",
    );
    const fake = fakeProcess("1.2.3");
    await createUpdateCommand(fake).run(["--check"], cli.context);
    expect(fake.calls[0].at(-1)).toBe(
      "https://mirror.example/herdr-world/herdr-world-linux-x64.update.json",
    );
    expect(cli.output.at(-1)).toBe("Up to date.");
  });

  test("installs over the running executable with the shared verifier", async () => {
    cli = createTestCli();
    const fake = fakeProcess("1.3.0");
    expect(await createUpdateCommand(fake).run([], cli.context)).toBe(EXIT_OK);
    const [shell, flag, script] = fake.calls[1];
    expect([shell, flag]).toEqual(["sh", "-c"]);
    expect(script).toContain(`target='${cli.context.runtime.execPath}'`);
    expect(script).toContain(`expected_sha256='${"a".repeat(64)}'`);
    expect(script).toContain('backup="$target.previous"');
    expect(cli.output).toContain(
      `Installed herdr-world 1.3.0 at ${cli.context.runtime.execPath}.`,
    );
    // The new release brings Herdr up to the version it declares.
    expect(fake.calls[2]).toEqual([
      cli.context.runtime.execPath,
      "herdr",
      "upgrade",
    ]);
  });

  test("a Herdr upgrade problem leaves the World update in place", async () => {
    cli = createTestCli();
    const fake = fakeProcess("1.3.0");
    const runProcess = async (argv: string[]) =>
      argv[1] === "herdr"
        ? {
            code: 1,
            stdout: "Upgraded Herdr 0.9.3 -> 0.9.5 at /example/herdr.",
            stderr: "Integration codex: failed",
          }
        : fake.runProcess(argv);
    expect(await createUpdateCommand({ runProcess }).run([], cli.context)).toBe(
      EXIT_OK,
    );
    expect(cli.output).toEqual(
      expect.arrayContaining([
        "Upgraded Herdr 0.9.3 -> 0.9.5 at /example/herdr.",
        "Integration codex: failed",
        "Herdr was not fully upgraded; run `herdr-world herdr upgrade` to retry.",
      ]),
    );
  });

  test("reports installer failures and refuses source checkouts", async () => {
    cli = createTestCli();
    expect(
      await createUpdateCommand(fakeProcess("1.3.0", 1)).run([], cli.context),
    ).toBe(EXIT_FAILURE);
    expect(cli.errors[0]).toBe("herdr-world update: checksum mismatch");
    cli.context.runtime.argv = ["bun", "/repo/server/src/index.ts"];
    expect(
      await createUpdateCommand(fakeProcess("1.3.0")).run([], cli.context),
    ).toBe(EXIT_FAILURE);
  });

  test.each(["VERSION", "package.json", "preview"])(
    "refuses replacement for %s without invoking the installer",
    async (ownership) => {
      cli = createTestCli();
      if (ownership === "preview") cli.context.version = "0.0.0-rc.193";
      else {
        const directory = dirname(cli.context.runtime.execPath);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(
            ownership === "VERSION" ? directory : dirname(directory),
            ownership,
          ),
          "managed",
        );
      }
      const fake = fakeProcess("1.3.0");
      expect(await createUpdateCommand(fake).run([], cli.context)).toBe(
        EXIT_FAILURE,
      );
      expect(fake.calls.some((argv) => argv[0] === "sh")).toBe(false);
      expect(cli.errors.join("\n")).toContain(
        ownership === "preview"
          ? "Pre-merge previews have no update channel"
          : "installation channel",
      );
    },
  );

  test("explains platforms without update packages", async () => {
    cli = createTestCli({ runtime: { platform: "win32" } });
    expect(
      await createUpdateCommand(fakeProcess("1.3.0")).run([], cli.context),
    ).toBe(EXIT_FAILURE);
    expect(cli.errors[0]).toContain("no update package for win32-x64");
  });
});

describe("herdr-world rollback", () => {
  function executable(path: string, version: string) {
    writeFileSync(path, `#!/bin/sh\necho 'herdr-world ${version}'\n`);
    chmodSync(path, 0o755);
  }

  test("swaps the executable with herdr-world.previous and back", async () => {
    cli = createTestCli();
    const current = cli.context.runtime.execPath;
    mkdirSync(join(cli.home, "bin"));
    executable(current, "1.2.3");
    executable(`${current}.previous`, "1.1.0");
    expect(await rollbackCommand.run([], cli.context)).toBe(EXIT_OK);
    expect(readFileSync(current, "utf8")).toContain("herdr-world 1.1.0");
    expect(readFileSync(`${current}.previous`, "utf8")).toContain(
      "herdr-world 1.2.3",
    );
    expect(cli.output[0]).toBe("Rolled back herdr-world 1.2.3 -> 1.1.0.");
    expect(await rollbackCommand.run([], cli.context)).toBe(EXIT_OK);
    expect(readFileSync(current, "utf8")).toContain("herdr-world 1.2.3");
  });

  test("leaves files alone when the previous executable is unusable", async () => {
    cli = createTestCli();
    const current = cli.context.runtime.execPath;
    mkdirSync(join(cli.home, "bin"));
    executable(current, "1.2.3");
    expect(await rollbackCommand.run([], cli.context)).toBe(EXIT_FAILURE);
    writeFileSync(`${current}.previous`, "#!/bin/sh\nexit 3\n");
    chmodSync(`${current}.previous`, 0o755);
    expect(await rollbackCommand.run([], cli.context)).toBe(EXIT_FAILURE);
    expect(readFileSync(current, "utf8")).toContain("herdr-world 1.2.3");
  });
});
