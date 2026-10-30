import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBrowserDeadline } from "../web/src/browserChrome";
import {
  runBrowserDiagnostics,
  type DiagnosticChild,
} from "./browser-diagnostics";

const adapter = new URL("./browser-diagnostics.ts", import.meta.url).pathname;

function fakeChrome(exit: Promise<number>, stderr: string): DiagnosticChild {
  return {
    exited: exit,
    signalCode: null,
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderr));
        void exit.then(() => controller.close());
      },
    }),
    kill: () => {},
  };
}

test("browser diagnostics preserve Chrome arguments and exit status while recording lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-diagnostics-test-"));
  const ready = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      if (new URL(request.url).pathname === "/ready") {
        await ready.promise;
        return new Response("ready");
      }
      if (server.upgrade(request)) return;
      return new Response("not found", { status: 404 });
    },
    websocket: {
      message(socket, data) {
        const message = JSON.parse(String(data));
        const target = {
          targetId: "synthetic-page",
          type: "page",
          url: "http://fixture.example.test/",
        };
        const result =
          message.method === "Target.getTargets"
            ? { targetInfos: [target] }
            : message.method === "Runtime.evaluate"
              ? { result: { value: '{"readyState":"complete"}' } }
              : {};
        socket.send(JSON.stringify({ id: message.id, result }));
        if (message.method === "Target.attachToTarget") {
          socket.send(
            JSON.stringify({
              method: "Target.attachedToTarget",
              params: { sessionId: "synthetic-session", targetInfo: target },
            }),
          );
        }
        if (message.method === "Page.setLifecycleEventsEnabled") {
          socket.send(
            JSON.stringify({
              method: "Page.lifecycleEvent",
              params: { name: "DOMContentLoaded" },
            }),
          );
        }
        if (message.method === "Runtime.enable") {
          socket.send(
            JSON.stringify({
              method: "Runtime.exceptionThrown",
              params: { exceptionDetails: { text: "synthetic fixture error" } },
            }),
          );
        }
        if (message.method === "Runtime.evaluate") ready.resolve();
      },
    },
  });
  try {
    let forwarded: string[] = [];
    const stderr: Uint8Array[] = [];
    const listeners = [
      process.listenerCount("SIGTERM"),
      process.listenerCount("SIGINT"),
    ];
    const result = runBrowserDiagnostics(
      {
        executable: "fake-chrome",
        directory: join(directory, "logs"),
        args: ["--window-size=1440,900", "http://fixture.example.test/"],
      },
      {
        spawn: (argv) => {
          forwarded = argv.slice(1);
          return fakeChrome(
            ready.promise.then(() => Bun.sleep(25)).then(() => 7),
            "DevTools listening on " +
              server.url.href.replace("http:", "ws:") +
              "\n",
          );
        },
        writeStderr: (chunk) => {
          stderr.push(chunk);
        },
      },
    );
    expect(await withBrowserDeadline(result, "diagnostic adapter", 5000)).toBe(
      7,
    );
    expect(forwarded).toEqual([
      "--enable-logging=stderr",
      "--remote-debugging-port=0",
      "--window-size=1440,900",
      "http://fixture.example.test/",
    ]);
    expect(Buffer.concat(stderr).toString()).toContain("DevTools listening on");
    expect([
      process.listenerCount("SIGTERM"),
      process.listenerCount("SIGINT"),
    ]).toEqual(listeners);
    const files = await readdir(join(directory, "logs"));
    expect(files).toHaveLength(1);
    const events = (await readFile(join(directory, "logs", files[0]!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        "launch",
        "debugger-connected",
        "page-target",
        "page-attached",
        "document-state",
        "page-exception",
        "Page.lifecycleEvent",
        "exit",
      ]),
    );
    expect(events.find((event) => event.event === "exit").data.code).toBe(7);
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser diagnostics require explicit configuration", async () => {
  const child = Bun.spawn([process.execPath, adapter], {
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      HERDR_DIAGNOSTIC_CHROME: "",
      HERDR_BROWSER_DIAGNOSTICS_DIR: "",
    },
  });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stderr).text()).toContain(
    "Set HERDR_DIAGNOSTIC_CHROME",
  );
});

test("stderr control mode preserves existing debugging flags without attaching an observer", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "browser-diagnostics-control-"),
  );
  try {
    let forwarded: string[] = [];
    const code = await runBrowserDiagnostics(
      {
        executable: "fake-chrome",
        directory: join(directory, "logs"),
        mode: "stderr",
        args: ["--remote-debugging-port=4321", "http://fixture.example.test/"],
      },
      {
        spawn: (argv) => {
          forwarded = argv.slice(1);
          return fakeChrome(Promise.resolve(7), "");
        },
      },
    );
    expect(code).toBe(7);
    expect(forwarded).toEqual([
      "--enable-logging=stderr",
      "--remote-debugging-port=4321",
      "http://fixture.example.test/",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser diagnostics exit when a descendant holds Chrome stderr open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-diagnostics-drain-"));
  const pidFile = join(directory, "descendant.pid");
  let adapterProcess: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const fake = join(directory, "fake-chrome");
    await Bun.write(
      fake,
      process.platform === "win32"
        ? `#!/usr/bin/env bun
const descendant = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
await Bun.write(Bun.env.FAKE_PID_FILE, String(descendant.pid));
console.error("synthetic descendant retains stderr");
process.exit(7);
`
        : `#!/bin/sh
sleep 30 &
printf '%s' "$!" > "$FAKE_PID_FILE"
printf '%s\n' 'synthetic descendant retains stderr' >&2
exit 7
`,
    );
    await chmod(fake, 0o755);
    adapterProcess = Bun.spawn([process.execPath, adapter], {
      stdout: "ignore",
      stderr: "ignore",
      env: {
        ...process.env,
        HERDR_DIAGNOSTIC_CHROME: fake,
        HERDR_BROWSER_DIAGNOSTICS_DIR: join(directory, "logs"),
        FAKE_PID_FILE: pidFile,
      },
    });
    expect(
      await withBrowserDeadline(adapterProcess.exited, "stderr drain", 3000),
    ).toBe(7);
    const files = await readdir(join(directory, "logs"));
    expect(
      await readFile(join(directory, "logs", files[0]!), "utf8"),
    ).toContain('"event":"stderr-drain-timeout"');
  } finally {
    const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    if (pid > 0) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    adapterProcess?.kill("SIGKILL");
    if (adapterProcess) await adapterProcess.exited;
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostic CLI preserves argument boundaries, stdout, stderr and exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diagnostic-cli-"));
  try {
    const fake = join(directory, "fake chrome");
    await Bun.write(
      fake,
      process.platform === "win32"
        ? '#!/usr/bin/env bun\nconsole.log(JSON.stringify(process.argv.slice(2)));\nconsole.error("synthetic chrome stderr boundary");\nprocess.exit(7);\n'
        : "#!/bin/sh\nprintf '%s\\0' \"$@\"\nprintf '%s\\n' 'synthetic chrome stderr boundary' >&2\nexit 7\n",
    );
    await chmod(fake, 0o755);
    const args = [
      "--window-size=1440,900",
      "http://fixture.example.test/a b",
      "",
      "synthetic\nargument",
    ];
    const child = Bun.spawn([process.execPath, adapter, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HERDR_DIAGNOSTIC_CHROME: fake,
        HERDR_BROWSER_DIAGNOSTICS_DIR: join(directory, "logs"),
        HERDR_BROWSER_DIAGNOSTICS_MODE: "lifecycle",
      },
    });
    expect(await child.exited).toBe(7);
    expect(await new Response(child.stderr).text()).toContain(
      "synthetic chrome stderr boundary",
    );
    const output = await new Response(child.stdout).text();
    expect(
      process.platform === "win32"
        ? JSON.parse(output)
        : output.split("\0").slice(0, -1),
    ).toEqual([
      "--enable-logging=stderr",
      "--remote-debugging-port=0",
      ...args,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
