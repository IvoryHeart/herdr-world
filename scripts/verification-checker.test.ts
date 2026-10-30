import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CheckerPortTaken,
  checkerPortPool,
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

const always = async () => true;

test("checker ports come only from unprivileged ports outside the ephemeral range", async () => {
  expect(ephemeralPortRange(() => "32768\t60999\n")).toEqual([32768, 60999]);
  expect(
    ephemeralPortRange(() => {
      throw new Error("no procfs");
    }),
  ).toEqual([49152, 65535]);
  // Below the range first, then above it.
  const pool = checkerPortPool([1030, 60999]);
  expect(pool.size).toBe(6 + 4536);
  expect([0, 5, 6, pool.size - 1].map(pool.port)).toEqual([
    1024, 1029, 61000, 65535,
  ]);
  expect([1029, 61000].map(pool.index)).toEqual([5, 6]);
  // A low configured range leaves only ports below it, never inside it.
  expect(
    await privateCheckerPort({
      range: [8192, 65535],
      free: always,
      start: 7167,
    }),
  ).toBe(8191);
  expect(
    await privateCheckerPort({
      range: [8192, 65535],
      free: always,
      start: 7168,
    }),
  ).toBe(1024);
  expect(() => checkerPortPool([1024, 65535])).toThrow(
    "narrow net.ipv4.ip_local_port_range",
  );
  // Taken ports are skipped, deterministically.
  const taken = new Set([1026, 1027]);
  expect(
    await privateCheckerPort({
      range: [1030, 65535],
      start: 2,
      free: async (port) => !taken.has(port),
    }),
  ).toBe(1028);
  // The next port after a taken one wraps at the end of the pool.
  expect(
    await privateCheckerPort({
      range: [1030, 65535],
      free: always,
      after: 1029,
    }),
  ).toBe(1024);
  expect(
    await privateCheckerPort({
      range: [1030, 60999],
      free: always,
      after: 1029,
    }),
  ).toBe(61000);
});

test("a daemon that never owns its port is not ready; one that comes to own it is", async () => {
  const { waitForOwnership } = await import(
    new URL("./verification-checker-ready.mjs", import.meta.url).href
  );
  const answers = [false, false, true];
  let asked = 0;
  await waitForOwnership(
    1,
    1024,
    Number.POSITIVE_INFINITY,
    async () => answers[asked++]!,
    async () => {},
  );
  expect(asked).toBe(3);
  // A foreign listener until the deadline: rejected, never "ready".
  await expect(
    waitForOwnership(
      1,
      1024,
      0,
      async () => false,
      async () => {},
    ),
  ).rejects.toThrow("not owned by the verified daemon");
});

const fakeChecker = async (root: string, body: string) => {
  const server = resolve(root, "server.mjs");
  await writeFile(server, body);
  return server;
};

(process.platform === "win32" ? test.skip : test)(
  "a checker whose port was taken while readiness was pending starts on the next port and says so",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "synthetic-checker-taken-"));
    try {
      // The first launch reports Apalache's exact bind failure; later ones
      // come up.
      const server = await fakeChecker(
        root,
        `import { existsSync, writeFileSync } from 'node:fs';
const marker = process.argv[3];
if (!existsSync(marker)) { writeFileSync(marker, ''); console.log('Error while starting Apalache server: Failed to bind to address 0.0.0.0/0.0.0.0:' + process.argv[2] + ': Address already in use'); process.exit(1); }
console.log('SYNTHETIC_READY'); setInterval(() => {}, 1000);`,
      );
      const marker = resolve(root, "taken-once");
      const notices: string[] = [];
      const launched: number[] = [];
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
          // The last pool port, so the next one wraps to the first.
          ports: { range: [1030, 65535], free: always, start: 5 },
          launch: (port) => {
            launched.push(port);
            return [process.execPath, server, String(port), marker];
          },
          // Pending, as for a listener the daemon does not own yet.
          readiness: async () => {
            await ready.promise;
            ready = Promise.withResolvers<void>();
          },
        },
      );
      expect(launched).toEqual([1029, 1024]);
      expect(used).toBe(1024);
      expect(notices).toEqual([
        "[checker] port 1029 was taken before the checker bound it; starting it on port 1024",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

(process.platform === "win32" ? test.skip : test)(
  "any other bind failure is final, launched once, and keeps its cause",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "synthetic-checker-denied-"));
    try {
      const server = await fakeChecker(
        root,
        `console.log('Error while starting Apalache server: Failed to bind to address 0.0.0.0/0.0.0.0:' + process.argv[2] + ': Permission denied'); process.exit(1);`,
      );
      let launches = 0;
      const outcome = withPrivateChecker(
        root,
        new AbortController().signal,
        async () => "unreachable",
        () => {},
        {
          ports: { range: [1030, 65535], free: always, start: 0 },
          launch: (port) => {
            launches++;
            return [process.execPath, server, String(port)];
          },
          readiness: () => new Promise(() => {}),
        },
      );
      await expect(outcome).rejects.toThrow("Permission denied");
      await expect(outcome).rejects.not.toBeInstanceOf(CheckerPortTaken);
      expect(launches).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

(process.platform === "win32" ? test.skip : test)(
  "a checker port taken on every attempt fails as a taken port after three launches",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "synthetic-checker-busy-"));
    try {
      const server = await fakeChecker(
        root,
        `console.log('Failed to bind to address 0.0.0.0/0.0.0.0:' + process.argv[2] + ': Address already in use'); process.exit(1);`,
      );
      const launched: number[] = [];
      await expect(
        withPrivateChecker(
          root,
          new AbortController().signal,
          async () => "unreachable",
          () => {},
          {
            ports: { range: [1030, 65535], free: always, start: 0 },
            launch: (port) => {
              launched.push(port);
              return [process.execPath, server, String(port)];
            },
            readiness: () => new Promise(() => {}),
          },
        ),
      ).rejects.toBeInstanceOf(CheckerPortTaken);
      expect(launched).toEqual([1024, 1025, 1026]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
