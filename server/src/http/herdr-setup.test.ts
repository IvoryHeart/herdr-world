import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERIFIED_HERDR_VERSION } from "../herdr/release";
import { assertManagedSetupAllowed } from "../herdr/bootstrap";
import type { HerdrUpgradeReport } from "../herdr/upgrade";
import type { LocalConnectionProfile } from "../connections/profiles";
import {
  createHerdrSetupHandlers,
  herdrSetupGuardForProfile,
} from "./herdr-setup";

test("setup guard uses the configured profile even without a ready runtime", () => {
  const config = {
    socketPath: "/tmp/herdr.sock",
    clientSocketPath: "/tmp/herdr-client.sock",
    hasExplicitSocketPath: false,
    hasExplicitClientSocketPath: false,
  };
  const local: LocalConnectionProfile = {
    id: "local",
    label: "Local",
    type: "local",
    control_socket_path: config.socketPath,
    client_socket_path: config.clientSocketPath,
    auto_connect: true,
  };
  expect(() =>
    assertManagedSetupAllowed(herdrSetupGuardForProfile(config, local)),
  ).not.toThrow();
  for (const profile of [
    { ...local, control_socket_path: "/tmp/custom-herdr.sock" },
    { ...local, client_socket_path: "/tmp/custom-client.sock" },
    {
      id: "remote",
      label: "Remote",
      type: "ssh" as const,
      ssh_destination: "example.com",
      remote_control_socket_path: config.socketPath,
      remote_client_socket_path: config.clientSocketPath,
      auto_connect: true,
    },
  ]) {
    expect(() =>
      assertManagedSetupAllowed(herdrSetupGuardForProfile(config, profile)),
    ).toThrow();
  }
  expect(() => herdrSetupGuardForProfile(config, undefined)).toThrow();
  expect(() =>
    assertManagedSetupAllowed(
      herdrSetupGuardForProfile(
        { ...config, hasExplicitSocketPath: true },
        local,
      ),
    ),
  ).toThrow();
});

test("missing installations require a verified asset, existing binaries do not", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "herdr-setup-target-"));
  try {
    for (const [platform, arch, available] of [
      // Herdr's installer runs its x86_64 build on Windows ARM64.
      ["win32", "arm64", true],
      ["linux", "ia32", false],
      ["freebsd", "x64", false],
      ["linux", "x64", true],
    ] as const) {
      const handlers = createHerdrSetupHandlers({
        guard: () => ({}),
        ping: async () => {
          throw new Error("not running");
        },
        bootstrap: {
          platform,
          arch,
          homeDir,
          appDataDir: homeDir,
          pathEnv: homeDir,
          binPathEnv: "",
        },
      });
      expect(await (await handlers.handleHerdrStatus()).json()).toMatchObject({
        state: "missing",
        can_setup: available,
      });
      const binaryPath = join(
        homeDir,
        platform === "win32" ? "herdr.exe" : "herdr",
      );
      writeFileSync(binaryPath, "existing installation");
      expect(await (await handlers.handleHerdrStatus()).json()).toMatchObject({
        state: "installed",
        can_setup: true,
      });
      rmSync(binaryPath);
    }
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("download deadline aborts stalled headers and bodies and releases the setup lock", async () => {
  for (const stage of ["headers", "body"]) {
    const homeDir = mkdtempSync(join(tmpdir(), "herdr-setup-timeout-"));
    const ready = Promise.withResolvers<void>();
    const deadline = new AbortController();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        if (stage === "headers") {
          ready.resolve();
          return new Promise<Response>(() => {});
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial download"));
            },
          }),
        );
      },
    });
    const nativeFetch = globalThis.fetch;
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      deadline.signal,
    );
    const download = spyOn(globalThis, "fetch").mockImplementation((async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const response = await nativeFetch(server.url, init);
      if (stage === "body") ready.resolve();
      return response;
    }) as typeof fetch);
    let running = false;
    const handlers = createHerdrSetupHandlers({
      guard: () => ({}),
      ping: async () => {
        if (!running) throw new Error("not running");
        return { version: "0.9.0", protocol: 22 };
      },
      bootstrap: {
        platform: "linux",
        arch: "x64",
        homeDir,
        pathEnv: "",
        binPathEnv: "",
        installService: () => {
          throw new Error("must not install a service");
        },
      },
    });
    const request = () =>
      new Request("http://localhost/api/herdr/setup", {
        method: "POST",
        headers: { "x-herdr-world-herdr-setup": "1" },
      });
    try {
      const pending = handlers.handleHerdrSetup(request());
      await ready.promise;
      expect(timeout).toHaveBeenCalledWith(120_000);
      expect((await handlers.handleHerdrSetup(request())).status).toBe(409);
      deadline.abort(new DOMException("Download timed out", "TimeoutError"));
      const failed = await pending;
      expect(failed.status).toBe(500);
      expect((await failed.json()).error).toMatch(/abort|timed out|timeout/i);
      expect(existsSync(join(homeDir, ".local", "bin", "herdr"))).toBe(false);
      expect(
        existsSync(join(homeDir, ".local", "bin", `.herdr.new-${process.pid}`)),
      ).toBe(false);
      running = true;
      expect((await handlers.handleHerdrSetup(request())).status).toBe(200);
    } finally {
      deadline.abort();
      download.mockRestore();
      timeout.mockRestore();
      await server.stop(true);
      rmSync(homeDir, { recursive: true, force: true });
    }
  }
});

test("setup UI metadata uses the pinned release and hides unsupported targets", async () => {
  for (const guard of [
    {},
    { sshHost: "example.com" },
    { session: "work" },
    { hasExplicitSocketPath: true },
  ]) {
    const handlers = createHerdrSetupHandlers({
      ping: async () => ({ version: "0.9.0", protocol: 22 }),
      guard: () => guard,
    });
    expect(await (await handlers.handleHerdrStatus()).json()).toEqual({
      state: "running",
      version: "0.9.0",
      protocol: 22,
      can_setup: Object.keys(guard).length === 0,
      verified_version: VERIFIED_HERDR_VERSION,
    });
    const response = await handlers.handleHerdrSetup(
      new Request("http://localhost/api/herdr/setup", { method: "POST" }),
    );
    expect(response.status).toBe(403);
  }
});

function upgradeHandlers(
  options: { sshHost?: string; run?: () => Promise<HerdrUpgradeReport> } = {},
) {
  const received: { worldVersion: string; server: unknown }[] = [];
  const server = {
    supervised: false,
    ping: async () => ({}),
    call: async () => ({}),
  };
  const handlers = createHerdrSetupHandlers({
    guard: () => ({ sshHost: options.sshHost }),
    ping: async () => ({ version: "0.9.3", protocol: 22 }),
    upgrade: {
      worldVersion: "0.3.0",
      server: () => server,
      plan: () => ({
        state: "outdated",
        binaryPath: "/example/herdr",
        version: "0.9.3",
      }),
      run: async (deps) => {
        received.push({ worldVersion: deps.worldVersion, server: deps.server });
        return (options.run ?? (async () => upgradeReport))();
      },
    },
  });
  return { handlers, received, server };
}

const upgradeReport: HerdrUpgradeReport = {
  before: { state: "outdated", binaryPath: "/example/herdr", version: "0.9.3" },
  binary: "upgraded",
  binaryPath: "/example/herdr",
  version: VERIFIED_HERDR_VERSION,
  server: { outcome: "handed-off" },
  integrations: [],
  plugin: { target: "ivoryheart.herdr-world", action: "current" },
};

function upgradeRequest(confirmed = true) {
  return new Request("http://localhost/api/herdr/upgrade", {
    method: "POST",
    headers: confirmed ? { "x-herdr-world-herdr-upgrade": "1" } : {},
  });
}

async function settledUpgrade(
  handlers: ReturnType<typeof upgradeHandlers>["handlers"],
) {
  for (;;) {
    const body = await handlers.handleHerdrUpgradeStatus().json();
    if (body.status !== "running") return body;
    await Bun.sleep(1);
  }
}

test("status offers the Herdr upgrade only for a local default connection", async () => {
  expect(
    await (await upgradeHandlers().handlers.handleHerdrStatus()).json(),
  ).toMatchObject({
    state: "running",
    upgrade: { state: "outdated", version: "0.9.3" },
    verified_version: VERIFIED_HERDR_VERSION,
  });
  const remote = await (
    await upgradeHandlers({
      sshHost: "example.com",
    }).handlers.handleHerdrStatus()
  ).json();
  expect(remote.upgrade).toBeUndefined();
});

test("a confirmed upgrade runs once in the background and reports its steps", async () => {
  const gate = Promise.withResolvers<void>();
  const { handlers, received, server } = upgradeHandlers({
    run: async () => {
      await gate.promise;
      return upgradeReport;
    },
  });
  expect((await handlers.handleHerdrUpgradeStatus().json()).status).toBe(
    "idle",
  );
  expect(handlers.handleHerdrUpgrade(upgradeRequest(false)).status).toBe(403);
  const started = handlers.handleHerdrUpgrade(upgradeRequest());
  expect(started.status).toBe(202);
  expect((await handlers.handleHerdrUpgradeStatus().json()).status).toBe(
    "running",
  );
  expect(handlers.handleHerdrUpgrade(upgradeRequest()).status).toBe(409);
  gate.resolve();
  expect(await settledUpgrade(handlers)).toEqual({
    status: "done",
    report: upgradeReport,
    lines: [
      `Upgraded Herdr 0.9.3 -> ${VERIFIED_HERDR_VERSION} at /example/herdr.`,
      "The running Herdr server handed its panes to the new version.",
    ],
  });
  expect(received).toEqual([{ worldVersion: "0.3.0", server }]);
});

test("upgrade failures are reported and release the lock", async () => {
  const { handlers } = upgradeHandlers({
    run: async () => {
      throw new Error("checksum does not match");
    },
  });
  expect(handlers.handleHerdrUpgrade(upgradeRequest()).status).toBe(202);
  expect(await settledUpgrade(handlers)).toEqual({
    status: "failed",
    error: "checksum does not match",
  });
  expect(handlers.handleHerdrUpgrade(upgradeRequest()).status).toBe(202);
  await settledUpgrade(handlers);
});

test("an SSH default connection cannot upgrade this machine's Herdr", async () => {
  const { handlers, received } = upgradeHandlers({ sshHost: "example.com" });
  const response = handlers.handleHerdrUpgrade(upgradeRequest());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("SSH host");
  expect(received).toEqual([]);
});
