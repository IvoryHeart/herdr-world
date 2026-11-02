import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageReader } from "./reader";
import { validateHostUsage } from "./host";
import { usageScope } from "./lifetime";

for (const mode of ["local", "ssh"] as const)
  test(`${mode} reader keeps its host cache, sends paths as data, and drops it on close`, async () => {
    const home = await fs.mkdtemp(join(tmpdir(), "usage-reader-"));
    const path = join(home, ".claude/projects/synthetic/session.jsonl");
    const now = Date.now() + 1000;
    const record = (id: string) =>
      JSON.stringify({
        type: "assistant",
        sessionId: "PRIVATE_SESSION",
        timestamp: new Date(now - 1).toISOString(),
        message: {
          id,
          model: "m",
          content: "PRIVATE_CONTENT",
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      }) + "\n";
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, record("a"));
    let started = 0,
      exited = 0;
    const reader = new UsageReader(
      mode === "ssh" ? "operator@example.test" : undefined,
      {
        worker: (program) => {
          started++;
          const worker = new Worker(
            new URL(
              `data:text/javascript,${encodeURIComponent(program.replace("home: os.homedir(), env: process.env", `home:${JSON.stringify(home)},env:{}`))}`,
            ),
          );
          worker.once("exit", () => {
            exited++;
          });
          return worker;
        },
        spawn: (argv) => {
          started++;
          expect(argv[0]).toBe("ssh");
          expect(argv.at(-2)).toBe("operator@example.test");
          expect(argv.at(-1)!.startsWith("sh -c ")).toBe(true);
          expect(argv.join(" ")).not.toContain(home);
          expect(argv.join(" ")).not.toContain("PRIVATE_SESSION");
          const child = Bun.spawn(["sh", "-c", argv.at(-1)!], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              HOME: home,
              CLAUDE_CONFIG_DIR: join(home, ".claude"),
              CODEX_HOME: join(home, ".codex"),
              PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
            },
          });
          return {
            ...child,
            stdin: child.stdin,
            stdout: child.stdout,
            stderr: child.stderr,
            kill: (signal) => child.kill(signal),
            exited: child.exited.then((code) => {
              exited++;
              return code;
            }),
          };
        },
      },
    );
    const owner = usageScope();
    try {
      const read = async () =>
        validateHostUsage(
          await reader.read(
            { now, files: [{ harness: "claude", path }] },
            owner.signal,
          ),
        );
      expect((await read()).rows[0]?.tokens.input).toBe(10);
      expect((await read()).rows[0]?.tokens.input).toBe(10);
      await fs.appendFile(path, record("b"));
      const result = await read();
      expect(result.rows[0]?.tokens.input).toBe(20);
      expect(started).toBe(1);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      await reader.close();
      expect(exited).toBe(1);
      await expect(read()).rejects.toThrow("closed");
    } finally {
      owner.dispose();
      await reader.close();
      await fs.rm(home, { recursive: true, force: true });
    }
  });

test("the local reader deadline terminates blocked source work before rejecting", async () => {
  let exited = false;
  const owner = usageScope(undefined, 50);
  const reader = new UsageReader(undefined, {
    worker: () => {
      const worker = new Worker(
        new URL(
          "data:text/javascript," +
            encodeURIComponent(
              "const {parentPort}=await import('node:worker_threads');parentPort.on('message',()=>{});",
            ),
        ),
      );
      worker.once("exit", () => {
        exited = true;
      });
      return worker;
    },
  });
  try {
    await expect(reader.read({ now: 1 }, owner.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(exited).toBe(true);
  } finally {
    owner.dispose();
    await reader.close();
  }
});
