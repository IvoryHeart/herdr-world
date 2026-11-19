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
import { configureServerLogger } from "../utils/logger";

/**
 * The Code view's IDE route through World's real listener: sign-in, the
 * enable gate, a World-owned server per folder, header and cookie rules,
 * the WebSocket pipe, logout and Stop. The IDE is a fake `serve-web`.
 */
beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

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
  const started = await startTestService(root);
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
    // The local connection is one Code can open on this computer.
    expect(status.localConnections).toEqual([connection.id]);

    const open = {
      provider: "vscode",
      connectionId: connection.id,
      generation: connection.generation,
      folder: project,
    };
    expect((await browser.call("world.ide.open", open)).refusal.code).toBe(
      "disabled",
    );
    await expect(
      browser.call("world.ide.enable", { provider: "vscode", trust: true }),
    ).rejects.toThrow(/terms/);
    await browser.call("world.ide.enable", {
      provider: "vscode",
      trust: true,
      acceptTerms: true,
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
    expect(seen.cookies).toEqual(["vscode-tkn"]);
    expect(seen.authorization).toBeNull();
    expect(seen.host).toBe(new URL(started.base).host);
    expect(page.headers.get("service-worker-allowed")).toBeNull();
    expect(page.headers.getSetCookie()).toEqual([
      `vscode-secret-key-path=${status.instances[0].url.slice(0, -1)}/mint; Path=${status.instances[0].url.slice(0, -1)}`,
    ]);

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
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a failing IDE says why, and disable stops running servers", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-route-"));
  const root = join(top, "data");
  const project = join(top, "project");
  mkdirSync(project, { recursive: true });
  const started = await startTestService(root);
  try {
    const cookie = await login(started.base, PASSWORD);
    const browser = await browserSocket(started.base, cookie);
    const [connection] = (await browser.call("connections.list")).connections;
    const open = {
      provider: "vscode",
      connectionId: connection.id,
      generation: connection.generation,
      folder: project,
    };

    await browser.call("world.ide.configure", {
      provider: "vscode",
      binary: fakeIde(top, { FAKE_IDE_FAIL: "1" }),
    });
    await browser.call("world.ide.enable", {
      provider: "vscode",
      trust: true,
      acceptTerms: true,
    });
    await browser.call("world.ide.open", open);
    const failed = await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "failed",
    );
    expect(failed.instances[0].reason).toContain(
      "the fake IDE was told to fail",
    );

    // Reopening after a failure starts afresh with the fixed program.
    await browser.call("world.ide.configure", {
      provider: "vscode",
      binary: fakeIde(join(top, "good")),
    });
    const reopened = await browser.call("world.ide.open", open);
    expect(reopened.instance.id).not.toBe(failed.instances[0].id);
    await until(
      () => browser.call("world.ide.status"),
      (value) => value.instances[0]?.state === "ready",
    );
    await browser.call("world.ide.disable", { provider: "vscode" });
    const after = await browser.call("world.ide.status");
    expect(after.instances).toEqual([]);
    expect(
      after.providers.find((entry: { id: string }) => entry.id === "vscode")
        .enabled,
    ).toBe(false);
    expect(existsSync(join(root, "ide.json"))).toBe(true);
    browser.close();
  } finally {
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);
