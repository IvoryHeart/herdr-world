import { afterAll, beforeAll, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestService } from "../service/testing/services";
import { configureServerLogger } from "../utils/logger";

beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

// Exercise the real HTTP router and socket cleanup, not a second test router.
test("logout after reauthentication closes earlier and later tabs, not other browsers", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdr-world-logout-"));
  const pushPath = join(root, "web-push.json");
  const sockets: WebSocket[] = [];
  const { service, base } = await startTestService(
    root,
    { host: "0.0.0.0", password: "logout-test-secret" },
    { HERDR_WORLD_WEB_PUSH_PATH: pushPath },
  );
  try {
    const request = (path: string, init?: RequestInit) =>
      fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
    const login = async (cookie = "") => {
      const response = await request("/api/login", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ password: "logout-test-secret" }),
      });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")?.split(";", 1)[0] ?? cookie;
    };
    const first = await login();
    const second = await login();
    const pushDevice = (id: string) => {
      const key = createECDH("prime256v1");
      key.generateKeys();
      return {
        subscription: {
          endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
          keys: {
            p256dh: key.getPublicKey().toString("base64url"),
            auth: randomBytes(16).toString("base64url"),
          },
        },
        preferences: { completed: true, blocked: true },
      };
    };
    const registerPush = async (cookie: string, id: string) => {
      const response = await request("/api/notifications/push", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-herdr-world-push": "1",
        },
        body: JSON.stringify(pushDevice(id)),
      });
      expect(response.status).toBe(200);
    };
    await registerPush(first, "first");
    await registerPush(second, "second");
    const connect = async (cookie: string) => {
      // Bun accepts custom handshake headers; lib.dom's constructor does not.
      const Socket = WebSocket as unknown as new (
        url: string,
        options: Bun.WebSocketOptions,
      ) => WebSocket;
      const ws = new Socket(base.replace("http:", "ws:") + "/ws", {
        headers: { cookie },
      });
      sockets.push(ws);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("WebSocket hello timed out")),
          5000,
        );
        ws.onmessage = (event) => {
          if (!JSON.parse(String(event.data)).hello) return;
          clearTimeout(timeout);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket failed"));
        };
      });
      return ws;
    };
    const a = await connect(first);
    const reauthenticated = await login(first);
    expect(reauthenticated).toBe(first);
    const sameBrowserTab = await connect(reauthenticated);
    const otherBrowser = await connect(second);
    const currentCookie = await login(reauthenticated);
    expect(currentCookie).toBe(first);
    const closures = [a, sameBrowserTab].map(
      (ws) =>
        new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Logout did not close socket")),
            5000,
          );
          ws.onclose = (event) => {
            clearTimeout(timeout);
            resolve(event.code);
          };
        }),
    );
    expect(
      (await request("/api/health", { headers: { cookie: first } })).status,
    ).toBe(200);
    expect(
      await (
        await request("/api/health", { headers: { cookie: first } })
      ).json(),
    ).toMatchObject({ ok: true });
    const page = await request("/login");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).toContain("/herdr-world-icon-192.png");
    const logo = await request("/herdr-world-icon-192.png");
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect(
      (await request("/api/logout", { headers: { cookie: first } })).status,
    ).toBe(405);
    expect(
      (
        await request("/api/logout", {
          method: "POST",
          headers: { cookie: first },
        })
      ).status,
    ).toBe(403);
    expect(a.readyState).toBe(WebSocket.OPEN);
    const logout = await request("/api/logout", {
      method: "POST",
      headers: { cookie: currentCookie, "x-herdr-world-logout": "1" },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    const pushRegistry = JSON.parse(await readFile(pushPath, "utf8"));
    expect(pushRegistry.devices).toHaveLength(1);
    expect(pushRegistry.devices[0].subscription.endpoint).toContain("/second");
    expect(await Promise.all(closures)).toEqual([4001, 4001]);
    expect(otherBrowser.readyState).toBe(WebSocket.OPEN);
    expect((await request("/api/health")).status).toBe(401);
    expect(
      (await request("/api/health", { headers: { cookie: second } })).status,
    ).toBe(200);
    const redirect = await request("/", {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    expect(redirect.headers.get("location")).toBe("/login");
    expect(await login()).not.toBe(first);
  } finally {
    for (const socket of sockets) socket.close();
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
