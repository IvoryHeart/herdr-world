import { describe, expect, test } from "bun:test";
import { findWindowsCore, setupLocalCore } from "./local-setup";

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

  test("Windows keeps an installed core and otherwise hands over to Herdr", async () => {
    const run = async () => {
      throw new Error("Windows runs no POSIX script");
    };
    expect(
      await setupLocalCore({
        setUp: true,
        log: () => {},
        run,
        platform: "win32",
        findWindowsCore: () =>
          "C:\\Users\\example\\AppData\\Local\\Programs\\herdr-core\\herdr-core.exe",
      }),
    ).toEqual({
      outcome: "kept",
      core: "C:\\Users\\example\\AppData\\Local\\Programs\\herdr-core\\herdr-core.exe",
    });
    expect(
      await setupLocalCore({
        setUp: false,
        log: () => {},
        run,
        platform: "win32",
        findWindowsCore: () => null,
      }),
    ).toEqual({ outcome: "herdr", core: null });
  });

  test("Windows finds core where its installer puts it, on PATH, or as a core hc", () => {
    const local = "C:\\Users\\example\\AppData\\Local";
    const installed = `${local}\\Programs\\herdr-core\\herdr-core.exe`;
    const none = () => null;
    expect(
      findWindowsCore(
        { LOCALAPPDATA: local },
        (path) => path === installed,
        none,
      ),
    ).toBe(installed);
    expect(
      findWindowsCore(
        { HC_INSTALL_DIR: "D:\\tools\\hc" },
        (path) => path === "D:\\tools\\hc\\herdr-core.exe",
        none,
      ),
    ).toBe("D:\\tools\\hc\\herdr-core.exe");
    const which = (found: Record<string, string>) => (name: string) =>
      found[name] ?? null;
    expect(
      findWindowsCore(
        {},
        () => false,
        which({ "herdr-core": "C:\\bin\\herdr-core.exe" }),
      ),
    ).toBe("C:\\bin\\herdr-core.exe");
    const hc = which({ hc: "C:\\bin\\hc.exe" });
    expect(
      findWindowsCore(
        {},
        () => false,
        hc,
        () => "hc 0.1.21",
      ),
    ).toBe("C:\\bin\\hc.exe");
    // Other programs ship an `hc` too.
    expect(
      findWindowsCore(
        {},
        () => false,
        hc,
        () => "hc-tool 2.0",
      ),
    ).toBe(null);
    expect(findWindowsCore({}, () => false, none)).toBe(null);
  });
});
