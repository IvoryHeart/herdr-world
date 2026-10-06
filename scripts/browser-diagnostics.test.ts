import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBrowserDeadline } from "../web/src/browserChrome";

const adapter = new URL("./browser-diagnostics.ts", import.meta.url).pathname;

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
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const fake = join(directory, "fake-chrome");
    await Bun.write(
      fake,
      `#!/usr/bin/env bun
console.log(JSON.stringify(process.argv.slice(2)));
console.error("DevTools listening on " + Bun.env.FAKE_DEBUG_URL);
await fetch(Bun.env.FAKE_READY_URL);
await new Promise(resolve => setTimeout(resolve, 25));
process.exit(7);
`,
    );
    await chmod(fake, 0o755);
    const adapterProcess = Bun.spawn(
      [
        process.execPath,
        adapter,
        "--window-size=1440,900",
        "http://fixture.example.test/",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HERDR_DIAGNOSTIC_CHROME: fake,
          HERDR_BROWSER_DIAGNOSTICS_DIR: join(directory, "logs"),
          FAKE_DEBUG_URL: server.url.href.replace("http:", "ws:"),
          FAKE_READY_URL: `${server.url.href}ready`,
        },
      },
    );
    child = adapterProcess;
    expect(
      await withBrowserDeadline(child.exited, "diagnostic adapter", 5000),
    ).toBe(7);
    expect(
      JSON.parse(await new Response(adapterProcess.stdout).text()),
    ).toEqual([
      "--enable-logging=stderr",
      "--remote-debugging-port=0",
      "--window-size=1440,900",
      "http://fixture.example.test/",
    ]);
    expect(await new Response(adapterProcess.stderr).text()).toContain(
      "DevTools listening on",
    );
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
    child?.kill();
    if (child) await child.exited;
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
    const fake = join(directory, "fake-chrome");
    await Bun.write(
      fake,
      "#!/usr/bin/env bun\nconsole.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n",
    );
    await chmod(fake, 0o755);
    const child = Bun.spawn(
      [
        process.execPath,
        adapter,
        "--remote-debugging-port=4321",
        "http://fixture.example.test/",
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
        env: {
          ...process.env,
          HERDR_DIAGNOSTIC_CHROME: fake,
          HERDR_BROWSER_DIAGNOSTICS_DIR: join(directory, "logs"),
          HERDR_BROWSER_DIAGNOSTICS_MODE: "stderr",
        },
      },
    );
    expect(await child.exited).toBe(7);
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual([
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
      `#!/usr/bin/env bun
const descendant = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
await Bun.write(Bun.env.FAKE_PID_FILE, String(descendant.pid));
console.error("synthetic descendant retains stderr");
process.exit(7);
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
