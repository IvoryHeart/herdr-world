import { expect, test } from "bun:test";
import { createConnection } from "node:net";
import {
  runVerificationProcess,
  systemVerificationProcessPorts,
} from "./verification-process";
import { ManualClock } from "./testing/manual-clock";

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest(
  "the native process port preserves stdout, stderr and exit status",
  async () => {
    const clock = new ManualClock();
    const result = await runVerificationProcess(
      [
        "node",
        "-e",
        "console.log('synthetic-output'); console.error('synthetic-error'); process.exit(7)",
      ],
      { timeoutMs: 2000 },
      { ...systemVerificationProcessPorts, clock, scheduler: clock },
    );
    expect(result.code).toBe(7);
    expect(result.stdout.trim()).toBe("synthetic-output");
    expect(result.stderr.trim()).toBe("synthetic-error");
    expect(clock.pending).toBe(0);
  },
);

unixTest(
  "the native process group port drains a ready SIGTERM-resistant grandchild",
  async () => {
    const clock = new ManualClock();
    let port = 0;
    let output = "";
    const grandchild =
      "process.on('SIGTERM',()=>{}); const server=require('node:net').createServer(); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));";
    const parent = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','inherit']}); child.stdout.pipe(process.stdout); setInterval(()=>{},1000);`;
    await expect(
      runVerificationProcess(
        ["node", "-e", parent],
        {
          timeoutMs: 500,
          graceMs: 50,
          onOutput(text) {
            output += text;
            if (!output.includes("\n")) return;
            port = Number(output.trim());
            // Readiness is observable; OS startup consumes no simulated deadline.
            clock.advance(500);
            clock.advance(50);
          },
        },
        { ...systemVerificationProcessPorts, clock, scheduler: clock },
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        reject(new Error("Checker grandchild survived timeout"));
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNREFUSED") resolve();
        else reject(error);
      });
    });
    expect(clock.pending).toBe(0);
  },
);
