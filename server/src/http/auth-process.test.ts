import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../config/server-config";
import { startTestService } from "../service/testing/services";
import { configureServerLogger } from "../utils/logger";

beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

const password = "logout-test-secret";

type ServiceOptions = {
  /** The data folder; a fresh one when omitted. */
  root?: string;
  config?: Partial<ServerConfig>;
  /** Per-file data paths, as the service environment names them. */
  environment?: Record<string, string>;
};

// Exercise the real HTTP router and socket cleanup, not a second test router.
async function withAuthServer(
  run: (base: string, sockets: WebSocket[]) => Promise<void>,
  options: ServiceOptions = {},
) {
  const root =
    options.root ?? (await mkdtemp(join(tmpdir(), "roamgate-logout-")));
  const sockets: WebSocket[] = [];
  const { service, base } = await startTestService(
    root,
    { password, ...options.config },
    options.environment,
  );
  try {
    await run(base, sockets);
  } finally {
    for (const socket of sockets) socket.close();
    await service.stop();
    if (!options.root) await rm(root, { recursive: true, force: true });
  }
}

test("logout after reauthentication closes earlier and later tabs, not other browsers", async () => {
  await withAuthServer(async (base, sockets) => {
    const request = (path: string, init?: RequestInit) =>
      fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
    const login = async (cookie = "") => {
      const response = await request("/api/login", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ password }),
      });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")?.split(";", 1)[0] ?? cookie;
    };
    const first = await login();
    const second = await login();
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
    ).toMatchObject({ auth_required: true });
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
      headers: { cookie: currentCookie, "x-roamgate-logout": "1" },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
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
  });
}, 20_000);

test("loopback requires login and forged forwarding headers cannot evade login cooldown", async () => {
  await withAuthServer(async (base) => {
    expect(
      (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) }))
        .status,
    ).toBe(401);
    const redirect = await fetch(base, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/login");
    for (let attempt = 0; attempt < 7; attempt++) {
      const response = await fetch(`${base}/api/login`, {
        signal: AbortSignal.timeout(5000),
        method: "POST",
        headers: {
          "x-forwarded-for": `192.0.2.${attempt + 1}`,
          "x-real-ip": `198.51.100.${attempt + 1}`,
        },
        body: JSON.stringify({ password: attempt === 6 ? password : "wrong" }),
      });
      expect(response.status).toBe(attempt < 5 ? 401 : 429);
      if (attempt >= 5) {
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
  });
}, 20_000);

test("development non-loopback binding still requires login", async () => {
  await withAuthServer(
    async (base) => {
      expect(
        (
          await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(5000),
          })
        ).status,
      ).toBe(401);
    },
    { config: { host: "0.0.0.0" } },
  );
}, 20_000);

test("instance naming is authenticated, persistent, and isolated from other instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "roamgate-instance-name-"));
  const settingsPath = join(root, "settings.json");
  const login = async (base: string) => {
    const response = await fetch(`${base}/api/login`, {
      method: "POST",
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";", 1)[0];
  };
  const save = (base: string, cookie: string, title_suffix: string) =>
    fetch(`${base}/api/instance-settings`, {
      method: "PUT",
      headers: {
        cookie,
        "x-herdr-world-settings": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ title_suffix }),
      signal: AbortSignal.timeout(5000),
    });
  const manifest = async (base: string, cookie: string) => {
    const response = await fetch(`${base}/manifest.json`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
    return response.json();
  };
  try {
    await withAuthServer(
      async (base) => {
        for (const path of ["/api/instance-settings", "/manifest.json"]) {
          expect(
            (
              await fetch(`${base}${path}`, {
                signal: AbortSignal.timeout(5000),
              })
            ).status,
          ).toBe(401);
        }
        expect((await save(base, "", "Unauthorized")).status).toBe(401);
        const cookie = await login(base);
        const get = await fetch(`${base}/api/instance-settings`, {
          headers: { cookie },
          signal: AbortSignal.timeout(5000),
        });
        expect(await get.json()).toEqual({ title_suffix: "" });
        expect(get.headers.get("cache-control")).toBe("no-store");
        const original = await manifest(base, cookie);
        expect(original.name).toBe("Herdr World");
        const saved = await save(base, cookie, "  Home  ");
        expect(saved.status).toBe(200);
        expect(await saved.json()).toEqual({ title_suffix: "Home" });
        expect(await manifest(base, cookie)).toEqual({
          ...original,
          name: "Herdr World \u00b7 Home",
          short_name: "Herdr World \u00b7 Home",
        });
        const html = await (
          await fetch(`${base}/`, {
            headers: { cookie, accept: "text/html" },
            signal: AbortSignal.timeout(5000),
          })
        ).text();
        expect(html).toContain("<title>Herdr World \u00b7 Home</title>");
        expect(html).toContain(
          'name="application-name" content="Herdr World \u00b7 Home"',
        );
        expect(html).toContain(
          'name="apple-mobile-web-app-title" content="Herdr World \u00b7 Home"',
        );
        await withAuthServer(async (otherBase) => {
          const otherCookie = await login(otherBase);
          expect((await manifest(otherBase, otherCookie)).name).toBe(
            "Herdr World",
          );
          expect((await save(otherBase, otherCookie, "Work")).status).toBe(200);
          expect((await manifest(otherBase, otherCookie)).name).toBe(
            "Herdr World \u00b7 Work",
          );
          expect((await manifest(base, cookie)).name).toBe(
            "Herdr World \u00b7 Home",
          );
        });
      },
      { environment: { HERDR_WORLD_SETTINGS_PATH: settingsPath } },
    );
    // A new service reads the same persisted name before serving its first page.
    await withAuthServer(
      async (base) => {
        const cookie = await login(base);
        expect((await manifest(base, cookie)).name).toBe(
          "Herdr World \u00b7 Home",
        );
        expect((await save(base, cookie, "")).status).toBe(200);
        expect((await manifest(base, cookie)).name).toBe("Herdr World");
      },
      { environment: { HERDR_WORLD_SETTINGS_PATH: settingsPath } },
    );
    expect((await Bun.file(settingsPath).json()).title_suffix).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("instance name save failures preserve the current name and permit retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "roamgate-instance-save-"));
  const blockedPath = join(root, "settings.json");
  try {
    await withAuthServer(
      async (base) => {
        // Import preflight must finish before injecting a runtime save failure.
        await mkdir(blockedPath);
        const response = await fetch(`${base}/api/login`, {
          method: "POST",
          body: JSON.stringify({ password }),
          signal: AbortSignal.timeout(5000),
        });
        const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
        const save = () =>
          fetch(`${base}/api/instance-settings`, {
            method: "PUT",
            headers: {
              cookie,
              "x-herdr-world-settings": "1",
              "content-type": "application/json",
            },
            body: JSON.stringify({ title_suffix: "Retry" }),
            signal: AbortSignal.timeout(5000),
          });
        const failed = await save();
        expect(failed.status).toBe(500);
        expect(await failed.json()).toEqual({
          error: "Unable to save instance name",
        });
        const get = () =>
          fetch(`${base}/api/instance-settings`, {
            headers: { cookie },
            signal: AbortSignal.timeout(5000),
          }).then((response) => response.json());
        expect(await get()).toEqual({ title_suffix: "" });
        await rm(blockedPath, { recursive: true });
        expect((await save()).status).toBe(200);
        expect(await get()).toEqual({ title_suffix: "Retry" });
      },
      { environment: { HERDR_WORLD_SETTINGS_PATH: blockedPath } },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test("PIN login uses a separate endpoint and preserves password recovery during PIN cooldown", async () => {
  await withAuthServer(
    async (base) => {
      const request = (path: string, init?: RequestInit) =>
        fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
      const page = await (await request("/login")).text();
      expect(page).toContain('inputmode="numeric"');
      expect(page).toContain("Use password or token instead");
      const pinLogin = (pin: string) =>
        request("/api/login/pin", {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
      const loggedIn = await pinLogin("012345");
      expect(loggedIn.status).toBe(200);
      const cookie = loggedIn.headers.get("set-cookie")!.split(";", 1)[0]!;
      expect(cookie).toContain("herdr_world_auth=");
      expect((await request("/", { headers: { cookie } })).status).toBe(200);
      for (let i = 0; i < 5; i++)
        expect((await pinLogin("654321")).status).toBe(401);
      const blocked = await pinLogin("012345");
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      const recovered = await request("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      expect(recovered.status).toBe(200);
      expect(recovered.headers.has("set-cookie")).toBe(true);
      expect((await pinLogin("012345")).status).toBe(429);
    },
    { config: { pin: "012345" } },
  );
});

test("PIN endpoint is disabled by default", async () => {
  await withAuthServer(async (base) => {
    const response = await fetch(`${base}/api/login/pin`, {
      method: "POST",
      body: JSON.stringify({ pin: "012345" }),
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(404);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await (await fetch(`${base}/login`)).text()).not.toContain(
      'inputmode="numeric"',
    );
  }, {});
});

test("instances with their own data folders on one home preserve independent sessions across restarts and credential rotations", async () => {
  const root = await mkdtemp(join(tmpdir(), "roamgate-instance-sessions-"));
  const first = {
    root: join(root, "first-data"),
    config: { password: "first-instance-password", pin: "012345" },
  };
  const second = {
    root: join(root, "second-data"),
    config: { password: "second-instance-password", pin: "654321" },
  };
  const login = async (base: string, loginPassword: string) => {
    const response = await fetch(`${base}/api/login`, {
      method: "POST",
      body: JSON.stringify({ password: loginPassword }),
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";", 1)[0]!;
  };
  const status = async (base: string, cookie: string) =>
    (
      await fetch(`${base}/api/health`, {
        headers: { cookie },
        signal: AbortSignal.timeout(5000),
      })
    ).status;
  let firstCookie = "";
  let secondCookie = "";
  let rotatedCookie = "";
  try {
    await withAuthServer(async (firstBase) => {
      firstCookie = await login(firstBase, first.config.password);
      await withAuthServer(async (secondBase) => {
        secondCookie = await login(secondBase, second.config.password);
        expect(await status(firstBase, firstCookie)).toBe(200);
        expect(await status(secondBase, secondCookie)).toBe(200);
        expect(await status(firstBase, secondCookie)).toBe(401);
        expect(await status(secondBase, firstCookie)).toBe(401);
      }, second);
    }, first);
    await withAuthServer(async (firstBase) => {
      expect(await status(firstBase, firstCookie)).toBe(200);
      await withAuthServer(async (secondBase) => {
        expect(await status(secondBase, secondCookie)).toBe(200);
        expect(await status(firstBase, firstCookie)).toBe(200);
      }, second);
    }, first);
    await withAuthServer(
      async (firstBase) => {
        expect(await status(firstBase, firstCookie)).toBe(401);
        rotatedCookie = await login(firstBase, "changed-instance-password");
        await withAuthServer(async (secondBase) => {
          expect(await status(secondBase, secondCookie)).toBe(200);
          expect(await status(firstBase, rotatedCookie)).toBe(200);
        }, second);
      },
      {
        ...first,
        config: { ...first.config, password: "changed-instance-password" },
      },
    );
    await withAuthServer(async (firstBase) => {
      expect(await status(firstBase, firstCookie)).toBe(401);
      expect(await status(firstBase, rotatedCookie)).toBe(401);
      const restoredCookie = await login(firstBase, first.config.password);
      expect(await status(firstBase, restoredCookie)).toBe(200);
      await withAuthServer(async (secondBase) => {
        expect(await status(secondBase, secondCookie)).toBe(200);
        expect(await status(firstBase, restoredCookie)).toBe(200);
      }, second);
    }, first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("a second World on the same data folder refuses to start", async () => {
  const data = await mkdtemp(join(tmpdir(), "world-instance-lock-"));
  try {
    await withAuthServer(
      async () => {
        expect(existsSync(join(data, "instance.lock"))).toBeTrue();
        const second = Bun.spawn([process.execPath, "server/src/index.ts"], {
          cwd: join(import.meta.dir, "../../.."),
          env: {
            ...process.env,
            HERDR_WORLD_DATA_DIR: data,
            HOST: "127.0.0.1",
            PORT: "0",
            OPEN_BROWSER: "0",
            HERDR_WORLD_PASSWORD: password,
            HERDR_SOCKET_PATH: join(data, "missing-control.sock"),
            HERDR_CLIENT_SOCKET_PATH: join(data, "missing-render.sock"),
          },
          stdout: "ignore",
          stderr: "pipe",
        });
        expect(await second.exited).toBe(1);
        expect(await new Response(second.stderr).text()).toContain(
          "is in use by World",
        );
        expect(existsSync(join(data, "instance.lock"))).toBeTrue();
      },
      { root: data },
    );
    // The first World released its folder when it stopped.
    expect(existsSync(join(data, "instance.lock"))).toBeFalse();
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}, 20_000);
