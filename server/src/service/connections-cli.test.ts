import { afterEach, beforeAll, afterAll, expect, test } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createConnectionsCommand } from "../cli/connections";
import { runCli } from "../cli/index";
import { createTestCli, type TestCli } from "../cli/test-context";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "../cli/command";
import { readWorldCliToken } from "../config/session-secret";
import { configureServerLogger } from "../utils/logger";
import { openStorage } from "./storage";
import { login, startTestService, type TestService } from "./testing/services";
import { AcquisitionHost } from "./testing/shared-acquisition-runtime";
import {
  SocketBrowser,
  StoreBrowser,
} from "./testing/composed-acquisition-clients";

let cli: TestCli;
let started: TestService;
let browser: SocketBrowser;
let page: StoreBrowser | undefined;
let cookie: string;
let releaseSave: (() => void) | undefined;
beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));
afterEach(async () => {
  releaseSave?.();
  releaseSave = undefined;
  await page?.close();
  page = undefined;
  await browser?.close();
  await started?.service.stop();
  cli?.cleanup();
});

async function fixture() {
  cli = createTestCli();
  const root = join(cli.home, "data");
  mkdirSync(root, { mode: 0o700 });
  const hosts = new Map(
    ["alpha", "beta", "gamma", "settings"].map((id) => [
      id,
      new AcquisitionHost(id),
    ]),
  );
  const stopped: string[] = [];
  const profile = (id: string) => ({
    id,
    label: id,
    type: "local",
    auto_connect: true,
    control_socket_path: join(root, `${id}-control.sock`),
    client_socket_path: join(root, `${id}-render.sock`),
  });
  const path = join(root, "connections.json");
  let blockSave: (() => Promise<void>) | undefined;
  let saveError: Error | undefined;
  writeFileSync(
    path,
    JSON.stringify({
      version: 2,
      default_connection_id: "alpha",
      profiles: [profile("alpha"), profile("beta")],
    }),
    { mode: 0o600 },
  );
  started = await startTestService(
    root,
    {
      taskNotificationSource: "status",
      hasExplicitSocketPath: false,
      hasExplicitClientSocketPath: false,
    },
    {},
    {
      adapters: {
        herdr: {
          createRuntime: (options) => {
            const id = options.identity!.id;
            const runtime = hosts.get(id)!.runtime(options);
            return {
              ...runtime,
              async stop() {
                stopped.push(id);
                await runtime.stop();
              },
            };
          },
        },
      },
      storage: async (paths, ports) => {
        const storage = await openStorage(paths, ports);
        const save = storage.connections.save.bind(storage.connections);
        storage.connections.save = async (registry) => {
          const block = blockSave;
          blockSave = undefined;
          await block?.();
          if (saveError) {
            const error = saveError;
            saveError = undefined;
            throw error;
          }
          await save(registry);
        };
        return storage;
      },
    },
  );
  await started.connected;
  cli.context.runtime.env.HERDR_WORLD_DATA_DIR = root;
  cli.writeConfig(`HOST=127.0.0.1\nPORT=${started.service.port}\n`);
  cookie = await login(started.base, "world-service-test-password");
  browser = new SocketBrowser(started.base, cookie);
  await browser.hello;
  const command = (args: string[]) =>
    runCli(["connections", ...args], cli.context, [createConnectionsCommand()]);
  const add = (id: string, extra: string[] = []) =>
    command([
      "add",
      id,
      "--control-socket",
      profile(id).control_socket_path,
      "--client-socket",
      profile(id).client_socket_path,
      ...extra,
    ]);
  const registry = () => JSON.parse(readFileSync(path, "utf8"));
  const holdSave = () => {
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    releaseSave = held.resolve;
    blockSave = () => {
      entered.resolve();
      return held.promise;
    };
    return { entered: entered.promise, release: held.resolve };
  };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${started.base}/api/connections/cli`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${readWorldCliToken(started.service.paths.sessionSecret)}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return {
    hosts,
    stopped,
    profile,
    add,
    command,
    registry,
    holdSave,
    rejectNextSave: () => {
      saveError = new Error("connection registry persistence failed");
    },
    post,
    path,
  };
}

test("CLI adds, changes default and removes live without retiring sibling runtimes", async () => {
  const f = await fixture();
  expect({
    code: await f.add("gamma", ["--auto-connect"]),
    errors: cli.errors,
  }).toEqual({ code: EXIT_OK, errors: [] });
  expect((await browser.call("connections.list")).connections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "gamma", state: "ready", generation: 1 }),
    ]),
  );
  expect(await f.command(["set-default", "gamma"])).toBe(EXIT_OK);
  expect((await browser.call("connections.list")).default_connection_id).toBe(
    "gamma",
  );
  expect(await f.command(["remove", "beta"])).toBe(EXIT_OK);
  expect(f.registry().profiles.map((p: { id: string }) => p.id)).toEqual([
    "alpha",
    "gamma",
  ]);
  expect(f.registry().default_connection_id).toBe("gamma");
  expect(f.stopped).toEqual(["beta"]);
  expect(f.hosts.get("alpha")!.instances).toHaveLength(1);
  expect(await browser.fence()).toBeDefined();
  expect(cli.commands.some((args) => args.includes("restart"))).toBe(false);
});

test.each(["add", "remove", "set-default"])(
  "CLI %s and a concurrent Settings change both survive service admission",
  async (action) => {
    const f = await fixture();
    const held = f.holdSave();
    const changing =
      action === "add"
        ? f.add("gamma", ["--auto-connect", "--default"])
        : f.command([action, "beta"]);
    await held.entered;
    const settings = browser.call("connections.create", {
      profile: f.profile("settings"),
    });
    held.release();
    const [code] = await Promise.all([changing, settings]);
    expect(code).toBe(EXIT_OK);
    const catalogue = await browser.call("connections.list");
    const expected = [
      "alpha",
      ...(action === "remove" ? [] : ["beta"]),
      ...(action === "add" ? ["gamma"] : []),
      "settings",
    ];
    expect(
      catalogue.connections.map((p: { id: string }) => p.id).sort(),
    ).toEqual(expected);
    expect(
      f
        .registry()
        .profiles.map((p: { id: string }) => p.id)
        .sort(),
    ).toEqual(expected);
    expect(catalogue.default_connection_id).toBe(
      action === "add" ? "gamma" : action === "remove" ? "alpha" : "beta",
    );
    expect(f.stopped).toEqual(action === "remove" ? ["beta"] : []);
  },
);

test("live admission requires a local native token and the service's registry", async () => {
  const f = await fixture();
  const before = f.registry();
  const body = {
    command: "remove",
    params: { id: "beta", registry_path: f.path },
  };
  expect((await f.post(body, { origin: started.base })).status).toBe(403);
  expect(
    (await f.post(body, { authorization: "Bearer wrong-token" })).status,
  ).toBe(401);
  expect(
    (
      await f.post({
        ...body,
        params: { ...body.params, registry_path: join(cli.home, "other.json") },
      })
    ).status,
  ).toBe(403);
  expect((await f.post({ ...body, command: "arbitrary" })).status).toBe(400);
  expect(f.registry()).toEqual(before);
  expect(f.stopped).toEqual([]);
});

test("live add without auto-connect stays disconnected and service validation prevents partial edits", async () => {
  const f = await fixture();
  expect(await f.add("gamma")).toBe(EXIT_OK);
  const catalogue = await browser.call("connections.list");
  expect(
    catalogue.connections.find((p: { id: string }) => p.id === "gamma"),
  ).toMatchObject({ state: "disconnected", auto_connect: false });
  expect(f.hosts.get("gamma")!.instances).toHaveLength(0);
  expect(await f.command(["remove", "alpha"])).toBe(EXIT_USAGE);
  expect(await f.command(["remove", "missing"])).toBe(EXIT_USAGE);
  expect(await f.command(["set-default", "missing"])).toBe(EXIT_USAGE);
  expect(await f.add("gamma")).toBe(EXIT_USAGE);
  expect(f.registry().default_connection_id).toBe("alpha");
  expect(f.stopped).toEqual([]);
});

test.each(["add", "remove", "set-default"])(
  "live %s persistence and I/O failures are service errors without offline writes",
  async (action) => {
    const f = await fixture();
    const before = f.registry();
    const change = () =>
      action === "add" ? f.add("gamma") : f.command([action, "beta"]);
    f.rejectNextSave();
    expect(await change()).toBe(EXIT_FAILURE);
    expect(cli.errors.at(-1)).toContain(
      "connection registry persistence failed",
    );
    expect(f.registry()).toEqual(before);

    // Force the real atomic rename to fail, independent of Unix permission rules.
    const backup = `${f.path}.backup`;
    renameSync(f.path, backup);
    mkdirSync(f.path);
    try {
      expect(await change()).toBe(EXIT_FAILURE);
      expect(cli.errors.at(-1)).toContain("No offline write was attempted");
      expect(JSON.parse(readFileSync(backup, "utf8"))).toEqual(before);
    } finally {
      rmSync(f.path, { recursive: true });
      renameSync(backup, f.path);
    }
    const catalogue = await browser.call("connections.list");
    expect(catalogue.default_connection_id).toBe("alpha");
    expect(catalogue.connections.map((p: { id: string }) => p.id)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(f.registry()).toEqual(before);
  },
);

test.each(["alpha", "beta"])(
  "removing viewed %s updates the real browser store and keeps its sibling usable",
  async (removedId) => {
    const f = await fixture();
    page = new StoreBrowser();
    await page.command("boot", { base: started.base, cookie });
    // The browser worker holds beta's Inspector while alpha is its active host.
    if (removedId === "alpha") {
      expect(await f.command(["set-default", "beta"])).toBe(EXIT_OK);
      await page.command("wait", {
        path: ["state", "defaultConnectionId"],
        value: "beta",
      });
    }
    const siblingId = removedId === "alpha" ? "beta" : "alpha";
    const removed = page.command("wait", {
      path: ["state", "connections", "length"],
      value: 1,
    });
    expect(await f.command(["remove", removedId])).toBe(EXIT_OK);
    const state = await removed;
    expect(state.state.status).toBe("connected");
    expect(state.state.connections.map((p: { id: string }) => p.id)).toEqual([
      siblingId,
    ]);
    expect(state.state.sessionsByConnectionId[removedId]).toBeUndefined();
    expect(
      state.state.sessionsByConnectionId[siblingId].serverRuntimeGeneration,
    ).toBe(1);
    expect(f.stopped).toEqual([removedId]);
    expect(f.hosts.get(siblingId)!.instances).toHaveLength(1);
    await expect(
      browser.call(
        "pane.list",
        {},
        { connection_id: removedId, connection_generation: 1 },
      ),
    ).rejects.toThrow();
    expect(
      await browser.call(
        "pane.list",
        {},
        { connection_id: siblingId, connection_generation: 1 },
      ),
    ).toHaveProperty("panes");
  },
);
