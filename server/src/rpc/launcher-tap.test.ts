import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import { claudeTapArgs } from "../usage/claude-tap";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { handleLauncherRpc } from "./launcher";
import type { ConnectionRpcContext } from "./context";

// Herdr's non-bracketed agent.start path submits a shell-escaped line plus
// Enter. A real canonical PTY reproduces the kernel's line limit; a pipe or
// sh -c would accept the old 8 KB inline tap and miss the reported failure.
const shellSubmission = String.raw`
import json, os, pty, select, subprocess, sys, termios, time
request = json.load(sys.stdin)
master, slave = pty.openpty()
child = subprocess.Popen(['/bin/sh', '-i'], stdin=slave, stdout=slave,
    stderr=slave, env=request['env'], start_new_session=True)
os.close(slave)
def prompt():
    data = b''
    deadline = time.monotonic() + 5
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
            raise TimeoutError('shell did not reach a prompt')
        data += os.read(master, 65536)
        if data.endswith(b'READY>'): return 'ready'
        if data.endswith(b'CONT>'): return 'continuation'
try:
    prompt()
    # /bin/sh can itself have a line editor (notably on macOS). Exercise
    # canonical input explicitly rather than depending on its startup mode.
    attributes = termios.tcgetattr(master)
    attributes[3] |= termios.ICANON
    termios.tcsetattr(master, termios.TCSANOW, attributes)
    os.write(master, request['command'].encode() + b'\n')
    print(json.dumps({'prompt': prompt()}))
finally:
    child.kill()
    child.wait()
    os.close(master)
`;

for (const remote of [false, true])
  (process.platform === "win32" ? test.skip : test)(
    `TUI Quick start Claude starts with the real tap through a canonical shell (${remote ? "SSH" : "local"})`,
    async () => {
      const root = mkdtempSync(join(tmpdir(), "tui-launch-' "));
      try {
        const bin = join(root, "bin");
        mkdirSync(bin);
        symlinkSync(Bun.which("node")!, join(bin, "node"));
        const captured = join(root, "argv.json");
        const harness = join(root, "harness.ts");
        writeFileSync(
          harness,
          `await Bun.write(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2)));`,
        );
        writeFileSync(
          join(bin, "claude"),
          `#!/bin/sh\nBUN_BE_BUN=1 exec ${shQuote(process.execPath)} --no-env-file ${shQuote(harness)} "$@"\n`,
          { mode: 0o700 },
        );
        const env = {
          HOME: root,
          PATH: `${bin}:/usr/bin:/bin`,
          ENV: "/dev/null",
          PS1: "READY>",
          PS2: "CONT>",
        };
        const runtime = remote
          ? { kind: "node" as const, path: join(bin, "node") }
          : { kind: "bun" as const, path: process.execPath };
        const realTap = claudeTapArgs(runtime);
        expect(Buffer.byteLength(realTap[1]!)).toBeGreaterThan(4096);
        let name = "";
        let launchedArgs: string[] = [];
        const call = async (
          method: string,
          params: Record<string, unknown>,
        ) => {
          if (method === "agent.list") return { agents: [] };
          if (method === "tab.create")
            return {
              tab: { tab_id: "w1:t1" },
              root_pane: { pane_id: "w1:p1", terminal_id: "new-terminal" },
            };
          if (method === "agent.start") {
            name = String(params.name);
            launchedArgs = params.args as string[];
            const child = Bun.spawn(["python3", "-c", shellSubmission], {
              stdin: Buffer.from(
                JSON.stringify({
                  env,
                  command: ["claude", ...launchedArgs].map(shQuote).join(" "),
                }),
              ),
              stdout: "pipe",
              stderr: "pipe",
            });
            const [exit, output, error] = await Promise.all([
              child.exited,
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
            ]);
            expect(error).toBe("");
            expect(exit).toBe(0);
            expect(JSON.parse(output)).toEqual({ prompt: "ready" });
            if (!existsSync(captured))
              throw new Error(
                "launch_truncated: Claude did not start in the TUI shell",
              );
            return {};
          }
          if (method === "pane.get")
            return { pane: { pane_id: "w1:p1", terminal_id: "new-terminal" } };
          if (method === "agent.get")
            return {
              agent: {
                pane_id: "w1:p1",
                terminal_id: "new-terminal",
                agent: "claude",
                name,
                interactive_ready: true,
              },
            };
          throw new Error(`unexpected ${method}`);
        };
        let result: unknown;
        const errors: unknown[] = [];
        const run = async (argv: string[], timeout: number) => {
          if (remote && argv[0] === "ssh") {
            // Simulate only transport: execute the exact remote command on
            // the isolated host, with its own HOME and filesystem.
            argv = ["/bin/sh", "-c", argv.at(-1)!];
          }
          return runProcessWithCodeTimeout(argv, timeout, { env });
        };
        await handleLauncherRpc({
          id: "launch",
          method: "launcher.start",
          params: { workspace_id: "w1", kind: "claude", label: "Builder" },
          route: {
            scope: "connection",
            connectionId: "alpha",
            generation: 3,
            isCurrent: () => true,
          },
          requestIsCurrent: () => true,
          connection: {
            ...herdrRuntimeFixture({ call }),
            sshHost: () => (remote ? "host.example" : undefined),
            remotePlatform: "unix",
            runProcessWithCodeTimeout: run,
          },
          sendReply: (reply: Record<string, unknown>) => {
            result = reply.result;
            return true;
          },
          sendError: (_context: string, error: unknown) => errors.push(error),
          services: {
            logger: { warn: () => {} },
            publishWorldInvalidation: () => {},
          },
        } as unknown as ConnectionRpcContext);
        expect(errors).toEqual([]);
        expect(result).toMatchObject({
          status: "started",
          terminal_id: "new-terminal",
        });
        expect(JSON.parse(readFileSync(captured, "utf8"))).toEqual(
          launchedArgs,
        );
        const settings = launchedArgs[launchedArgs.indexOf("--settings") + 1]!;
        // The complete original tap, including newlines and nested quotes,
        // reaches Claude as settings. No stubbed or shortened tap program.
        expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(
          JSON.parse(realTap[1]!),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    15_000,
  );

(process.platform === "win32" ? test.skip : test)(
  "tap preparation failure creates no tab and starts no agent",
  async () => {
    const errors: unknown[] = [];
    const calls: string[] = [];
    await handleLauncherRpc({
      id: "launch",
      method: "launcher.start",
      params: { workspace_id: "w1", kind: "claude", label: "Builder" },
      route: {
        scope: "connection",
        connectionId: "alpha",
        generation: 3,
        isCurrent: () => true,
      },
      requestIsCurrent: () => true,
      connection: {
        ...herdrRuntimeFixture({
          call: async (method: string) => {
            calls.push(method);
            throw new Error("must not call Herdr");
          },
        }),
        sshHost: () => undefined,
        runProcessWithCodeTimeout: async () => ({
          code: 1,
          stdout: "",
          stderr: "private host error",
        }),
      },
      sendReply: () => {
        throw new Error("must not succeed");
      },
      sendError: (_context: string, error: unknown) => errors.push(error),
      services: {
        logger: { warn: () => {} },
        publishWorldInvalidation: () => {},
      },
    } as unknown as ConnectionRpcContext);
    expect(calls).toEqual([]);
    expect(errors.map(String)).toEqual([
      "Error: Could not prepare Claude's launch settings on this host. No agent was started.",
    ]);
  },
);
