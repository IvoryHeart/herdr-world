import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CheckerPortTaken,
  ephemeralPortRange,
  privateCheckerPort,
  withPrivateChecker,
} from "./verification-checker";

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
        `process.on('SIGTERM',()=>{console.log('SYNTHETIC_TEARDOWN');process.exit(0)}); console.log('SYNTHETIC_READY'); setInterval(()=>{},1000);`,
      );
      const cancellation = new AbortController();
      const reason = new Error("Synthetic checker teardown cancellation");
      // Ready once the fake daemon has said so, as the real probe waits for
      // an actual connection rather than for the daemon to start.
      const serverReady = Promise.withResolvers<void>();
      let pid = 0;
      await expect(
        withPrivateChecker(
          root,
          cancellation.signal,
          async () => "synthetic result",
          (text) => {
            if (text.includes("SYNTHETIC_READY")) serverReady.resolve();
            if (text.includes("SYNTHETIC_TEARDOWN")) cancellation.abort(reason);
          },
          {
            launch: (port) => [process.execPath, server, String(port)],
            readiness: async (_, owner) => {
              await serverReady.promise;
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

test("the checker port comes from below the ephemeral range, skipping taken ports", async () => {
  expect(ephemeralPortRange(() => "32768\t60999\n")).toEqual([32768, 60999]);
  expect(
    ephemeralPortRange(() => {
      throw new Error("no procfs");
    }),
  ).toEqual([49152, 65535]);
  const taken = new Set([10_005, 10_006]);
  expect(
    await privateCheckerPort({
      range: [32768, 60999],
      start: 5,
      free: async (port) => !taken.has(port),
    }),
  ).toBe(10_007);
  const chosen = await privateCheckerPort({ range: [32768, 60999] });
  expect(chosen).toBeGreaterThanOrEqual(10_000);
  expect(chosen).toBeLessThan(32768);
});

(process.platform === "win32" ? test.skip : test)(
  "a checker whose port was taken starts again on the next free port and says so",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "synthetic-checker-taken-"));
    try {
      const server = resolve(root, "server.mjs");
      // The first launch reports the bind failure Apalache prints; later
      // launches come up.
      await writeFile(
        server,
        `import { existsSync, writeFileSync } from 'node:fs';
const marker = process.argv[3];
if (!existsSync(marker)) { writeFileSync(marker, ''); console.log('Error while starting Apalache server: Failed to bind to address 0.0.0.0/0.0.0.0:' + process.argv[2] + ': Address already in use'); process.exit(1); }
console.log('SYNTHETIC_READY'); setInterval(() => {}, 1000);`,
      );
      const marker = resolve(root, "taken-once");
      const first = await privateCheckerPort();
      const notices: string[] = [];
      let ready = Promise.withResolvers<void>();
      const used = await withPrivateChecker(
        root,
        new AbortController().signal,
        async (port) => port,
        (text) => {
          if (text.includes("SYNTHETIC_READY")) ready.resolve();
          if (text.startsWith("[checker]")) notices.push(text.trim());
        },
        {
          port: async () => first,
          launch: (port) => [process.execPath, server, String(port), marker],
          readiness: async () => {
            await ready.promise;
            ready = Promise.withResolvers<void>();
          },
        },
      );
      expect(used).toBeGreaterThan(first);
      expect(notices).toEqual([
        `[checker] port ${first} was taken before the checker bound it; starting it on port ${used}`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

(process.platform === "win32" ? test.skip : test)(
  "a checker port taken on every attempt fails as a taken port",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "synthetic-checker-busy-"));
    try {
      const server = resolve(root, "server.mjs");
      await writeFile(
        server,
        `console.log('Failed to bind to address 0.0.0.0:' + process.argv[2] + ': Address already in use'); process.exit(1);`,
      );
      await expect(
        withPrivateChecker(
          root,
          new AbortController().signal,
          async () => "unreachable",
          () => {},
          {
            launch: (port) => [process.execPath, server, String(port)],
            readiness: () => new Promise(() => {}),
          },
        ),
      ).rejects.toBeInstanceOf(CheckerPortTaken);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
