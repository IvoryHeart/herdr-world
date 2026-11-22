import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserSocket,
  login,
  startTestService,
} from "../service/testing/services";
import { AcquisitionHost } from "../service/testing/shared-acquisition-runtime";
import { configureServerLogger } from "../utils/logger";

/**
 * The Code view's IDE route through World's real listener: sign-in, the
 * enable gate, a World-owned server per folder, header and cookie rules,
 * the WebSocket pipe, logout and Stop. The IDE is a fake `serve-web` and
 * code-server.
 */
beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

/** VS Code's protocol framing: type, id, ack, length, then the body. */
function controlMessage(body: object) {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const bytes = new Uint8Array(13 + json.length);
  bytes[0] = 2;
  new DataView(bytes.buffer).setUint32(9, json.length);
  bytes.set(json, 13);
  return bytes;
}

const PASSWORD = "world-service-test-password";

function fakeIde(top: string, env: Record<string, string> = {}) {
  const path = join(top, "bin", "code-tunnel");
  mkdirSync(join(top, "bin"), { recursive: true });
  const exports = Object.entries(env)
    .map(([key, value]) => `export ${key}='${value}'\n`)
    .join("");
  writeFileSync(
    path,
    `#!/bin/sh\n${exports}exec '${process.execPath}' '${join(import.meta.dir, "testing", "fake-ide-server.ts")}' "$@"\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

/**
 * A service whose startup connection is a steady synthetic Herdr: an IDE
 * lives only as long as the connection generation it was opened under.
 */
async function startService(root: string) {
  const host = new AcquisitionHost("ide");
  const started = await startTestService(
    root,
    {},
    {},
    {
      adapters: {
        herdr: { createRuntime: (options) => host.runtime(options) },
      },
    },
  );
  await started.connected;
  return started;
}

/** World's stop leaves its IDE servers running: Stop them as a person would. */
async function stopIdes(base: string) {
  const browser = await browserSocket(base, await login(base, PASSWORD));
  try {
    for (const instance of (await browser.call("world.ide.status")).instances)
      await browser.call("world.ide.stop", { instanceId: instance.id });
  } finally {
    browser.close();
  }
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out: ${JSON.stringify(value)}`);
    await Bun.sleep(50);
  }
}

test("World proxies an enabled IDE on its own origin and keeps its credentials apart", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-route-"));
  const root = join(top, "data");
  const project = join(top, "project");
  mkdirSync(project, { recursive: true });
  const program = fakeIde(top, { FAKE_IDE_DOWNLOADS: "2" });
  const started = await startService(root);
  try {
    const cookie = await login(started.base, PASSWORD);
    const browser = await browserSocket(started.base, cookie);
    const { connections } = await browser.call("connections.list");
    const connection = connections[0];

    // Discovery found nothing on a bare PATH; the owner points at a program.
    await browser.call("world.ide.configure", {
      provider: "vscode",
      binary: program,
    });
    let status = await browser.call("world.ide.status");
    const vscode = status.providers.find(
      (entry: { id: string }) => entry.id === "vscode",
    );
    expect(vscode.detection).toMatchObject({
      state: "detected",
      path: program,
      version: "1.99.0",
    });
    expect(vscode.enabled).toBe(false);
    expect(vscode.needsSecurePage).toBe(true);
    // The local connection is one Code can open on this computer.
    expect(status.localConnections).toEqual([connection.id]);

    // Stock VS Code is embedded too, behind the same gate; its webviews
    // load from vscode-cdn.net, the one origin the IDE frame rule admits.
    await expect(
      browser.call("world.ide.enable", { provider: "vscode", trust: true }),
    ).rejects.toThrow(/terms/);
    await browser.call("world.ide.enable", {
      provider: "vscode",
      trust: true,
      acceptTerms: true,
    });
    status = await browser.call("world.ide.status");
    expect(
      status.providers.find((entry: { id: string }) => entry.id === "vscode")
        .enabled,
    ).toBe(true);

    await browser.call("world.ide.configure", {
      provider: "code-server",
      binary: program,
    });
    const open = {
      provider: "code-server",
      connectionId: connection.id,
      generation: connection.generation,
      folder: project,
    };
    expect((await browser.call("world.ide.open", open)).refusal.code).toBe(
      "disabled",
    );
    await expect(
      browser.call("world.ide.enable", { provider: "code-server" }),
    ).rejects.toThrow(/trust/);
    await browser.call("world.ide.enable", {
      provider: "code-server",
      trust: true,
    });

    expect(
      (
        await browser.call("world.ide.open", {
          ...open,
          generation: connection.generation + 1,
        })
      ).refusal.code,
    ).toBe("stale");
    expect(
      (
        await browser.call("world.ide.open", {
          ...open,
          folder: join(top, "nope"),
        })
      ).refusal.code,
    ).toBe("folder");

    const opened = await browser.call("world.ide.open", open);
    expect(opened.ok).toBe(true);
    const again = await browser.call("world.ide.open", open);
    expect(again.instance.id).toBe(opened.instance.id);
    status = await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "ready",
    );
    const url = `${started.base}${status.instances[0].url}`;

    // Signed out: World's login guards the route.
    expect((await fetch(url, { redirect: "manual" })).status).toBe(401);

    const page = await fetch(url, {
      headers: {
        cookie: `${cookie}; vscode-tkn=forged`,
        authorization: "Bearer owner",
      },
    });
    expect(page.status).toBe(200);
    const seen = await page.json();
    // code-server is served at its root, without World's or forged cookies.
    expect(seen.path).toBe("/");
    expect(seen.cookies).toEqual([]);
    expect(seen.authorization).toBeNull();
    expect(seen.host).toBe(new URL(started.base).host);
    expect(page.headers.get("service-worker-allowed")).toBeNull();
    expect(page.headers.getSetCookie()).toEqual([
      `vscode-secret-key-path=/mint; Path=${status.instances[0].url.slice(0, -1)}`,
    ]);

    // Its port proxies never reach another local service, HTTP or socket.
    for (const path of ["proxy/3000/", "absproxy/3000/x", "%70roxy/3000/"])
      expect(
        (await fetch(`${url}${path}`, { headers: { cookie } })).status,
      ).toBe(403);

    const away = await fetch(url.replace(/\/$/, "/away"), {
      headers: { cookie },
      redirect: "manual",
    });
    expect(away.status).toBe(502);
    const inside = await fetch(url.replace(/\/$/, "/inside"), {
      headers: { cookie },
      redirect: "manual",
    });
    expect(inside.headers.get("location")).toBe(status.instances[0].url);
    expect(
      (
        await fetch(`${started.base}/ide/AAAAAAAAAAAAAAAAAAAAAA/`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);

    // The WebSocket goes through to the IDE and closes on logout.
    const Socket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket;
    const ws = new Socket(url.replace("http:", "ws:").replace(/\/$/, "/ws"), {
      headers: { cookie },
    });
    const echoed = new Promise<string>((resolve, reject) => {
      ws.onmessage = (event) => resolve(String(event.data));
      ws.onerror = () => reject(new Error("IDE socket failed"));
    });
    const closed = new Promise<number>((resolve) => {
      ws.onclose = (event) => resolve(event.code);
    });
    ws.onopen = () => ws.send("hello");
    expect(await echoed).toBe("echo:hello");
    const proxied = new Socket(
      url.replace("http:", "ws:").replace(/\/$/, "/proxy/3000/"),
      { headers: { cookie } },
    );
    expect(
      await new Promise<string>((resolve) => {
        proxied.onopen = () => resolve("opened");
        proxied.onerror = () => resolve("refused");
      }),
    ).toBe("refused");
    const logout = await fetch(`${started.base}/api/logout`, {
      method: "POST",
      headers: { cookie, "x-herdr-world-logout": "1" },
    });
    expect(logout.ok).toBe(true);
    expect(await closed).toBe(4001);

    // Stop ends the server and its route.
    const cookie2 = await login(started.base, PASSWORD);
    const browser2 = await browserSocket(started.base, cookie2);
    await browser2.call("world.ide.stop", {
      instanceId: status.instances[0].id,
    });
    expect((await browser2.call("world.ide.status")).instances).toEqual([]);
    expect((await fetch(url, { headers: { cookie: cookie2 } })).status).toBe(
      404,
    );
    browser2.close();
    browser.close();
  } finally {
    await stopIdes(started.base).catch(() => {});
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a failing IDE says why, and disable leaves running servers to Stop", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-route-"));
  const root = join(top, "data");
  const project = join(top, "project");
  mkdirSync(project, { recursive: true });
  const started = await startService(root);
  try {
    const cookie = await login(started.base, PASSWORD);
    const browser = await browserSocket(started.base, cookie);
    const [connection] = (await browser.call("connections.list")).connections;
    const open = {
      provider: "code-server",
      connectionId: connection.id,
      generation: connection.generation,
      folder: project,
    };

    await browser.call("world.ide.configure", {
      provider: "code-server",
      binary: fakeIde(top, { FAKE_IDE_FAIL: "1" }),
    });
    await browser.call("world.ide.enable", {
      provider: "code-server",
      trust: true,
    });
    await browser.call("world.ide.open", open);
    const failed = await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "failed",
    );
    expect(failed.instances[0].reason).toContain(
      "the fake IDE was told to fail",
    );

    // Reopening after a failure starts afresh with the fixed program, under
    // the same identity on the host.
    await browser.call("world.ide.configure", {
      provider: "code-server",
      binary: fakeIde(join(top, "good")),
    });
    const reopened = await browser.call("world.ide.open", open);
    expect(reopened.instance.id).toBe(failed.instances[0].id);
    expect(reopened.instance.state).toBe("starting");
    await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "ready",
    );
    await browser.call("world.ide.disable", { provider: "code-server" });
    const after = await browser.call("world.ide.status");
    // Disabling stops none: the server stays listed until Stop.
    expect(after.instances).toEqual([
      expect.objectContaining({
        id: failed.instances[0].id,
        state: "detached",
      }),
    ]);
    await browser.call("world.ide.stop", {
      instanceId: failed.instances[0].id,
    });
    expect((await browser.call("world.ide.status")).instances).toEqual([]);
    expect(
      after.providers.find(
        (entry: { id: string }) => entry.id === "code-server",
      ).enabled,
    ).toBe(false);
    expect(existsSync(join(root, "ide.json"))).toBe(true);
    browser.close();
  } finally {
    await stopIdes(started.base).catch(() => {});
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a connection change closes the IDE's open sockets and its route", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-route-"));
  const root = join(top, "data");
  const project = join(top, "project");
  mkdirSync(project, { recursive: true });
  const started = await startService(root);
  try {
    const cookie = await login(started.base, PASSWORD);
    const browser = await browserSocket(started.base, cookie);
    const [connection] = (await browser.call("connections.list")).connections;
    await browser.call("world.ide.configure", {
      provider: "code-server",
      binary: fakeIde(top),
    });
    await browser.call("world.ide.enable", {
      provider: "code-server",
      trust: true,
    });
    await browser.call("world.ide.open", {
      provider: "code-server",
      connectionId: connection.id,
      generation: connection.generation,
      folder: project,
    });
    const status = await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "ready",
    );
    const url = `${started.base}${status.instances[0].url}`;
    const Socket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket;
    const ws = new Socket(url.replace("http:", "ws:").replace(/\/$/, "/ws"), {
      headers: { cookie },
    });
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });
    const closed = new Promise<string>((resolve) => {
      ws.onclose = (event) => resolve(event.reason);
    });

    // Disconnecting retires that runtime generation: World lets go of the
    // IDE (its sockets and route) and the server runs on, listed with Stop.
    await browser.call("connections.disconnect", { id: connection.id });
    expect(await closed).toBe("World disconnected from the IDE server");
    expect((await fetch(url, { headers: { cookie } })).status).toBe(404);
    const after = await browser.call("world.ide.status");
    expect(after.instances).toEqual([
      expect.objectContaining({
        id: status.instances[0].id,
        state: "detached",
        startedAt: status.instances[0].startedAt,
      }),
    ]);
    // Only Stop ends it.
    await browser.call("world.ide.stop", {
      instanceId: status.instances[0].id,
    });
    expect((await browser.call("world.ide.status")).instances).toEqual([]);
    browser.close();
  } finally {
    await stopIdes(started.base).catch(() => {});
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("VS Code's workbench handshake reaches its server with the token the browser never had", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-route-"));
  const root = join(top, "data");
  const project = join(top, "project");
  mkdirSync(project, { recursive: true });
  const started = await startService(root);
  try {
    const cookie = await login(started.base, PASSWORD);
    const browser = await browserSocket(started.base, cookie);
    const [connection] = (await browser.call("connections.list")).connections;
    await browser.call("world.ide.configure", {
      provider: "vscode",
      binary: fakeIde(top),
    });
    await browser.call("world.ide.enable", {
      provider: "vscode",
      trust: true,
      acceptTerms: true,
    });
    await browser.call("world.ide.open", {
      provider: "vscode",
      connectionId: connection.id,
      generation: connection.generation,
      folder: project,
    });
    const status = await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "ready",
    );
    const url = `${started.base}${status.instances[0].url}`;
    // The page never hands the browser the token VS Code would read.
    const page = await fetch(url, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(
      page.headers.getSetCookie().some((entry) => entry.includes("vscode-tkn")),
    ).toBe(false);
    // So the workbench opens its socket with a placeholder; World fills the
    // token in and the server accepts it.
    const Socket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket;
    const workbench = new Socket(
      url.replace("http:", "ws:").replace(/\/$/, "/ws"),
      { headers: { cookie } },
    );
    workbench.binaryType = "arraybuffer";
    const handshake = new Promise<string>((resolve, reject) => {
      workbench.onmessage = (event) => resolve(String(event.data));
      workbench.onerror = () => reject(new Error("IDE socket failed"));
    });
    workbench.onopen = () =>
      workbench.send(
        controlMessage({
          type: "auth",
          auth: "00000000000000000000",
          data: "x",
        }),
      );
    expect(await handshake).toBe("auth:ok");
    workbench.close();
    browser.close();
  } finally {
    await stopIdes(started.base).catch(() => {});
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);
