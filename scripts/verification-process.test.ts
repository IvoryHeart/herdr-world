import { expect, test } from "bun:test";
import { createConnection } from "node:net";
import {
  runVerificationProcess,
  VerificationProcessError,
} from "./verification-process";

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest("bounded checker commands preserve output and status", async () => {
  const result = await runVerificationProcess(
    ["node", "-e", "console.log('synthetic-output'); process.exit(7)"],
    { timeoutMs: 2000 },
  );
  expect(result.code).toBe(7);
  expect(result.stdout.trim()).toBe("synthetic-output");
});

unixTest("timeout drains a SIGTERM-resistant checker grandchild", async () => {
  let port = 0;
  const grandchild =
    "process.on('SIGTERM',()=>{}); const server=require('node:net').createServer(); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));";
  const parent = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','inherit']}); child.stdout.pipe(process.stdout); setInterval(()=>{},1000);`;
  await expect(
    runVerificationProcess(["node", "-e", parent], {
      timeoutMs: 500,
      graceMs: 50,
      onOutput: (text) => {
        port = Number(text.trim());
      },
    }),
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
});

unixTest(
  "abort drains the owned command without crediting cancellation as success",
  async () => {
    const controller = new AbortController();
    await expect(
      runVerificationProcess(
        ["node", "-e", "console.log('ready'); setInterval(()=>{},1000)"],
        {
          timeoutMs: 2000,
          signal: controller.signal,
          graceMs: 20,
          onOutput: () => controller.abort(),
        },
      ),
    ).rejects.toMatchObject({ reason: "aborted" });
  },
);

unixTest("observer errors and excessive output fail the command", async () => {
  const failure = new Error("synthetic observer failure");
  await expect(
    runVerificationProcess(
      ["node", "-e", "console.log('ready'); setInterval(()=>{},1000)"],
      {
        timeoutMs: 2000,
        graceMs: 20,
        onOutput: () => {
          throw failure;
        },
      },
    ),
  ).rejects.toBe(failure);
  await expect(
    runVerificationProcess(
      ["node", "-e", "console.log('x'.repeat(4096)); setInterval(()=>{},1000)"],
      {
        timeoutMs: 2000,
        graceMs: 20,
        maxOutputBytes: 100,
      },
    ),
  ).rejects.toBeInstanceOf(VerificationProcessError);
});
