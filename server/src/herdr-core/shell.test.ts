import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreShellArgv } from "./shell";
import { harnessOfArgv } from "./harness";
import { coreHarnessReadiness, resolveCoreExecutable } from "./host";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(platform: "Linux" | "Darwin", shellProgram?: string) {
  const root = mkdtempSync(join(tmpdir(), "world-core-shell-"));
  roots.push(root);
  const bin = join(root, "bin");
  const tools = join(root, "shell tools");
  mkdirSync(bin);
  mkdirSync(tools);
  const executable = (path: string, script: string) => {
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  executable(join(bin, "uname"), `echo ${platform}`);
  executable(join(tools, "bun"), "echo shell-bun");
  executable(join(tools, "codex"), 'bun --version; printf "<%s>\\n" "$@"');
  executable(join(tools, "claude"), 'bun --version; printf "<%s>\\n" "$@"');
  // A synthetic account shell: insist on the platform's terminal startup mode,
  // then add tools just as its interactive rc would. Never read the real rc.
  const shell = executable(
    join(bin, "account shell"),
    [
      `[ "$1" = ${platform === "Darwin" ? "-lic" : "-ic"} ] || exit 91`,
      "shift",
      'export PATH="$HOME/shell tools:$PATH"',
      'exec /bin/sh -c "$@"',
    ].join("\n"),
  );
  writeFileSync(
    join(root, ".bashrc"),
    'export PATH="$HOME/shell tools:$PATH"\n',
  );
  const env = {
    HOME: root,
    PATH: `${bin}:/usr/bin:/bin`,
    SHELL: shellProgram ?? shell,
  };
  const run = async (argv: string[]) => {
    const proc = Bun.spawn(argv, { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { stdout, code };
  };
  return { tools, run };
}

describe("the core agent's shell environment", () => {
  for (const platform of ["Linux", "Darwin"] as const) {
    for (const kind of ["claude", "codex"])
      test(`${platform} ${kind}: resolve and run with shell-only tools, keeping arguments literal`, async () => {
        const host = fixture(platform);
        const executable = await resolveCoreExecutable(
          {
            windows: false,
            run: (script) => host.run(["/bin/sh", "-c", script]),
          },
          kind,
        );
        expect(executable).toBe(join(host.tools, kind));
        const args = [
          "",
          "a b",
          "quote'\"",
          "$(exit 92); `exit 93`\nnext",
          "--resume",
        ];
        const argv = coreShellArgv([executable, ...args]);
        expect(harnessOfArgv(argv)).toBe(kind);
        const result = await host.run(argv);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe(
          `shell-bun\n${args.map((arg) => `<${arg}>\n`).join("")}`,
        );
      });
  }

  test("Windows keeps its native executable and arguments", () => {
    const argv = ["C:\\Tools\\codex.cmd", "a b"];
    expect(coreShellArgv(argv)).toEqual(argv);
  });

  test.skipIf(!Bun.which("bash"))(
    "a real Bash rc supplies bun to the agent",
    async () => {
      const host = fixture("Linux", Bun.which("bash")!);
      const executable = await resolveCoreExecutable(
        {
          windows: false,
          run: (script) => host.run(["/bin/sh", "-c", script]),
        },
        "codex",
      );
      const result = await host.run(
        coreShellArgv([executable, "bun --version"]),
      );
      expect(result.code).toBe(0);
      expect(result.stdout.endsWith("shell-bun\n<bun --version>\n")).toBe(true);
    },
  );

  test("New agent offers a harness installed only in the shell's PATH", async () => {
    const host = fixture("Linux");
    const readiness = await coreHarnessReadiness(
      {
        windows: false,
        run: (script) => host.run(["/bin/sh", "-c", script]),
      },
      ["codex"],
    );
    expect(readiness).toMatchObject([{ kind: "codex", installed: true }]);
  });
});
