import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withPrivateChecker } from "./verification-checker";

function connection(port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
    });
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
}
(process.platform === "win32" ? test.skip : test)(
  "early checker advertisement waits for readiness before executing the client",
  async () => {
    const temporary = await mkdtemp(
      resolve(tmpdir(), "synthetic-checker-ready-"),
    );
    const server = resolve(temporary, "server.mjs");
    try {
      await writeFile(
        server,
        `import { createServer } from 'node:net';
const port = Number(process.argv[2]);
console.log('The Apalache server is running on port ' + port + '.');
setTimeout(() => createServer(socket => socket.end()).listen(port, '127.0.0.1'), 100);`,
      );
      let ready = false;
      await withPrivateChecker(
        temporary,
        new AbortController().signal,
        async (port) => {
          expect(ready).toBe(true);
          await connection(port);
        },
        undefined,
        {
          launch: (port) => [process.execPath, server, String(port)],
          readiness: async (port, owner) => {
            const deadline = Date.now() + 2000;
            for (;;) {
              try {
                await connection(port);
                break;
              } catch (error) {
                if (Date.now() >= deadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            }
            const { ownsCheckerPort } = await import(
              new URL("./verification-checker-ready.mjs", import.meta.url).href
            );
            expect(await ownsCheckerPort(owner, port)).toBe(true);
            expect(await ownsCheckerPort(process.pid, port)).toBe(false);
            ready = true;
          },
        },
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
(process.platform === "win32" ? test.skip : test)(
  "checker readiness failure rejects without executing or retaining the daemon",
  async () => {
    const temporary = await mkdtemp(
      resolve(tmpdir(), "synthetic-checker-failed-"),
    );
    const server = resolve(temporary, "server.mjs");
    try {
      await writeFile(
        server,
        `console.log('The Apalache server is running on port ' + process.argv[2] + '.'); setInterval(() => {}, 1000);`,
      );
      let called = false;
      let pid = 0;
      await expect(
        withPrivateChecker(
          temporary,
          new AbortController().signal,
          async () => {
            called = true;
          },
          undefined,
          {
            launch: (port) => [process.execPath, server, String(port)],
            readiness: async (_, owner) => {
              pid = owner;
              throw new Error("Synthetic readiness failure");
            },
          },
        ),
      ).rejects.toThrow("Synthetic readiness failure");
      expect(called).toBe(false);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

(process.platform === "win32" ? test.skip : test)(
  "external cancellation during owned checker teardown rejects its completed result",
  async () => {
    const root = await mkdtemp(
      resolve(tmpdir(), "synthetic-checker-retirement-"),
    );
    try {
      const server = resolve(root, "server.mjs");
      await writeFile(
        server,
        `process.on('SIGTERM',()=>{console.log('SYNTHETIC_TEARDOWN');process.exit(0)}); console.log('The Apalache server is running on port '+process.argv[2]+'.'); setInterval(()=>{},1000);`,
      );
      const cancellation = new AbortController();
      const reason = new Error("Synthetic checker teardown cancellation");
      let pid = 0;
      await expect(
        withPrivateChecker(
          root,
          cancellation.signal,
          async () => "synthetic result",
          (text) => {
            if (text.includes("SYNTHETIC_TEARDOWN")) cancellation.abort(reason);
          },
          {
            launch: (port) => [process.execPath, server, String(port)],
            readiness: async (_, owner) => {
              pid = owner;
            },
          },
        ),
      ).rejects.toBe(reason);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
