import { describe, expect, test } from "bun:test";
import { setupLocalCore } from "./local-setup";

const PROBE = (core = "") =>
  `target=linux-x86_64\ncore=${core}\nherdr=\ndir=/example/.local/bin\nlogin=systemd\n`;
const isProbe = (input: string) =>
  input.endsWith("\nherdr_core_probe </dev/null\n");

/** A fake host: the probe prints its facts; setup prints a line. */
function host(core = "", setupCode = 0) {
  const inputs: string[] = [];
  const lines: string[] = [];
  return {
    inputs,
    lines,
    log: (line: string) => lines.push(line),
    run: async (
      _argv: string[],
      input: string,
      _timeout: number,
      onLine: (line: string) => void,
    ) => {
      inputs.push(input);
      if (isProbe(input))
        for (const line of PROBE(core).split("\n")) onLine(line);
      else onLine("herdr-core is running.");
      return {
        code: isProbe(input) ? 0 : setupCode,
        stderr: setupCode ? "herdr-core: herdr-core did not start\n" : "",
      };
    },
  };
}

describe("core first on this computer (CLI)", () => {
  test("upgrade --install keeps an installed core and runs nothing else", async () => {
    const h = host("/example/.local/bin/herdr-core");
    expect(
      await setupLocalCore({
        setUp: false,
        log: h.log,
        run: h.run,
        platform: "linux",
      }),
    ).toEqual({ outcome: "kept", core: "/example/.local/bin/herdr-core" });
    expect(h.inputs).toHaveLength(1);
  });

  test("setup starts an installed core now and at login, installing nothing", async () => {
    const h = host("/example/.local/bin/herdr-core");
    expect(
      await setupLocalCore({
        setUp: true,
        log: h.log,
        run: h.run,
        platform: "linux",
      }),
    ).toEqual({
      outcome: "set-up",
      core: "/example/.local/bin/herdr-core",
      installed: false,
    });
    expect(h.inputs[1]).toEndWith("\nherdr_core_setup </dev/null\n");
  });

  test("with no core, both install and start it", async () => {
    for (const setUp of [false, true]) {
      const h = host();
      expect(
        await setupLocalCore({
          setUp,
          log: h.log,
          run: h.run,
          platform: "darwin",
        }),
      ).toEqual({
        outcome: "set-up",
        core: "/example/.local/bin/herdr-core",
        installed: true,
      });
      expect(h.lines).toEqual(["herdr-core is running."]);
    }
  });

  test("a failed start is said in the script's words", async () => {
    const h = host("/example/.local/bin/herdr-core", 1);
    expect(
      await setupLocalCore({
        setUp: true,
        log: h.log,
        run: h.run,
        platform: "linux",
      }),
    ).toEqual({
      outcome: "failed",
      core: "/example/.local/bin/herdr-core",
      error: "herdr-core did not start",
    });
  });

  test("Windows installs and starts core with the PowerShell steps, never Herdr", async () => {
    const argvs: string[][] = [];
    const inputs: string[] = [];
    const dir = "C:\\Users\\example\\AppData\\Local\\Programs\\herdr-core";
    const run = async (
      argv: string[],
      input: string,
      _timeout: number,
      onLine: (line: string) => void,
    ) => {
      argvs.push(argv);
      inputs.push(input);
      if (input.endsWith("\nherdr_core_probe\n"))
        for (const line of `target=windows-x86_64\ncore=\nherdr=\ndir=${dir}\nlogin=startup\n`.split(
          "\n",
        ))
          onLine(line);
      else onLine("herdr-core is running.");
      return { code: 0, stderr: "" };
    };
    expect(
      await setupLocalCore({
        setUp: false,
        log: () => {},
        run,
        platform: "win32",
      }),
    ).toEqual({
      outcome: "set-up",
      core: `${dir}\\herdr-core.exe`,
      installed: true,
    });
    for (const argv of argvs) {
      expect(argv[0]).toEndWith("powershell.exe");
      expect(argv.at(-1)).toBe(
        "& ([scriptblock]::Create([Console]::In.ReadToEnd()))",
      );
    }
    expect(inputs[0]).toContain("function herdr_core_probe");
    expect(inputs[1]).toEndWith("\nherdr_core_setup '' 'default'\n");
  });

  test("Windows keeps an installed core as it is", async () => {
    const core =
      "C:\\Users\\example\\AppData\\Local\\Programs\\herdr-core\\herdr-core.exe";
    const inputs: string[] = [];
    const run = async (
      _argv: string[],
      input: string,
      _timeout: number,
      onLine: (line: string) => void,
    ) => {
      inputs.push(input);
      for (const line of `target=windows-x86_64\ncore=${core}\nherdr=\ndir=C:\\x\nlogin=startup`.split(
        "\n",
      ))
        onLine(line);
      return { code: 0, stderr: "" };
    };
    expect(
      await setupLocalCore({
        setUp: false,
        log: () => {},
        run,
        platform: "win32",
      }),
    ).toEqual({ outcome: "kept", core });
    expect(inputs).toHaveLength(1);
  });
});
