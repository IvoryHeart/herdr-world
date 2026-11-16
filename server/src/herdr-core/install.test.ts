import { describe, expect, test } from "bun:test";
import { coreInstallInput, createCoreInstall, parseCoreProbe } from "./install";

const PROBE =
  "target=linux-x86_64\ncore=\nherdr=\ndir=/example/.local/bin\nlogin=systemd\n";

const isProbe = (input: string) =>
  input.endsWith("\nherdr_core_probe </dev/null\n");

type Call = { argv: string[]; input: string };

function harness(
  options: {
    probe?: string;
    setupCode?: number;
    setupStderr?: string;
    coreProfiles?: Array<{
      id: string;
      type: string;
      state: string;
      ssh_destination?: string;
      core_session?: string;
      core_state_dir?: string;
    }>;
    /** What a connect attempt ends in (World's connection state). */
    connectsTo?: { state: string; error?: { message: string } };
  } = {},
) {
  const calls: Call[] = [];
  const created: unknown[] = [];
  const connected: unknown[] = [];
  let finishSetup: () => void = () => {};
  const setupDone = new Promise<void>((done) => {
    finishSetup = done;
  });
  const ready = () => options.connectsTo ?? { state: "ready" };
  const install = createCoreInstall({
    profiles: () => ({
      list: () => [
        { id: "dev", type: "ssh", ssh_destination: "dev.example.com" },
        {
          id: "win",
          type: "ssh",
          ssh_destination: "win.example.com",
          remote_platform: "windows",
        },
      ],
      coreList: () =>
        (options.coreProfiles ?? []).map((profile) => ({
          core_session: "default",
          core_state_dir: "",
          ...profile,
        })),
      create: async (value) => {
        created.push(value);
        return { ...(value as object), ...ready() };
      },
      connect: async (id) => {
        connected.push(id);
        return { id, ...ready() };
      },
    }),
    fixture: { start: async () => ({}) },
    latestVersion: async () => "0.1.21",
    sleep: async () => {},
    run: async (argv, input, _timeout, onLine) => {
      calls.push({ argv, input });
      if (isProbe(input)) {
        for (const line of (options.probe ?? PROBE).split("\n")) onLine(line);
        return { code: 0, stderr: "" };
      }
      onLine(
        "Installed herdr-core 0.1.21 into /example/.local/bin/herdr-core.",
      );
      await setupDone;
      return {
        code: options.setupCode ?? 0,
        stderr: options.setupStderr ?? "",
      };
    },
  });
  return { install, calls, created, connected, finishSetup };
}

async function settle(
  install: ReturnType<typeof harness>["install"],
  host: unknown,
) {
  for (let i = 0; i < 50; i++) {
    const status = install.status(host);
    if (status.phase !== "installing") return status;
    await Promise.resolve();
    await new Promise((done) => setTimeout(done, 0));
  }
  throw new Error("install did not settle");
}

describe("herdr-core install from World", () => {
  test("the script call is appended with a checked version and closed stdin", () => {
    expect(coreInstallInput("setup", "0.1.21")).toEndWith(
      "\nherdr_core_setup '0.1.21' </dev/null\n",
    );
    expect(coreInstallInput("setup", null, "work")).toEndWith(
      "\nherdr_core_setup '' 'work' </dev/null\n",
    );
    expect(() => coreInstallInput("setup", null, "a;b")).toThrow(
      "invalid herdr-core session",
    );
    expect(coreInstallInput("probe")).toEndWith(
      "\nherdr_core_probe </dev/null\n",
    );
    expect(() => coreInstallInput("setup", "1.0.0'; rm -rf ~; '")).toThrow(
      "invalid herdr-core version",
    );
  });

  test("probe facts parse; an unsupported target is null", () => {
    expect(parseCoreProbe(PROBE)).toEqual({
      target: "linux-x86_64",
      core: null,
      herdr: null,
      dir: "/example/.local/bin",
      login: "systemd",
    });
    expect(
      parseCoreProbe(
        "target=unsupported\ncore=/x/hc\nherdr=\ndir=/x\nlogin=\n",
      ),
    ).toMatchObject({ target: null, core: "/x/hc", login: "none" });
    expect(() => parseCoreProbe("hello")).toThrow("did not describe itself");
  });

  test("only this computer or a known non-Windows SSH host", async () => {
    const { install, calls } = harness();
    await expect(
      install.probe({ type: "ssh", destination: "other.example.com" }),
    ).rejects.toThrow(
      "only on this computer or an SSH host in Manage connections",
    );
    await expect(
      install.probe({ type: "ssh", destination: "win.example.com" }),
    ).rejects.toThrow("only on this computer");
    await expect(install.probe({ type: "shell" })).rejects.toThrow(
      "choose this computer or an SSH host",
    );
    expect(calls).toHaveLength(0);
    const probed = await install.probe({
      type: "ssh",
      destination: "dev.example.com",
    });
    expect(probed.version).toBe("0.1.21");
    expect(calls[0]!.argv).toContain("dev.example.com");
    expect(calls[0]!.argv.at(-1)).toBe("sh -s");
  });

  test("a confirmed install runs setup, then adds and connects a core profile", async () => {
    const h = harness();
    const started = h.install.install({ type: "local" }, "0.1.21");
    expect(started.phase).toBe("installing");
    expect(() => h.install.install({ type: "local" }, "0.1.21")).toThrow(
      "already being installed there",
    );
    h.finishSetup();
    const status = await settle(h.install, { type: "local" });
    expect(status.phase).toBe("done");
    expect(status.connection_id).toBe("core-local");
    expect(status.lines).toContain(
      "Installed herdr-core 0.1.21 into /example/.local/bin/herdr-core.",
    );
    expect(h.calls[0]!.argv).toEqual(["sh", "-s"]);
    expect(h.calls[0]!.input).toContain("herdr_core_setup '0.1.21'");
    expect(h.created).toEqual([
      {
        id: "core-local",
        label: "herdr-core on this computer",
        type: "local",
        runtime: "herdr-core",
        core_session: "default",
        core_state_dir: "",
        auto_connect: true,
      },
    ]);
  });

  test("an existing core profile for the host is connected, not duplicated", async () => {
    const h = harness({
      coreProfiles: [
        {
          id: "core-dev",
          type: "ssh",
          state: "unavailable",
          ssh_destination: "dev.example.com",
        },
      ],
    });
    const host = { type: "ssh", destination: "dev.example.com" };
    h.install.install(host, null);
    h.finishSetup();
    const status = await settle(h.install, host);
    expect(status.connection_id).toBe("core-dev");
    expect(h.connected).toEqual(["core-dev"]);
    expect(h.created).toHaveLength(0);
  });

  test("a failure gives the script's plain words and connects nothing", async () => {
    const h = harness({
      setupCode: 1,
      setupStderr:
        "noise\nherdr-core: the download is damaged (checksum mismatch); try again\n",
    });
    h.install.install({ type: "local" }, null);
    h.finishSetup();
    const status = await settle(h.install, { type: "local" });
    expect(status.phase).toBe("failed");
    expect(status.error).toBe(
      "the download is damaged (checksum mismatch); try again",
    );
    expect(h.created).toHaveLength(0);
  });

  test("the testing switch installs nothing and starts the preview core", async () => {
    const h = harness();
    expect((await h.install.probe({ type: "local" }, true)).probe.core).toBe(
      null,
    );
    h.install.install({ type: "local" }, "0.1.21", "ok");
    const ok = await settle(h.install, { type: "local" });
    expect(ok).toMatchObject({ phase: "done", connection_id: "core-fixture" });
    h.install.install({ type: "local" }, "0.1.21", "error");
    const failed = await settle(h.install, { type: "local" });
    expect(failed.error).toContain("checksum mismatch");
    expect(h.calls).toHaveLength(0);
  });

  test("an install under a saved connection starts its session and connects only it", async () => {
    const h = harness({
      coreProfiles: [
        { id: "core-local", type: "local", state: "error" },
        {
          id: "core-work",
          type: "local",
          state: "error",
          core_session: "work",
        },
      ],
    });
    const started = h.install.install(
      { type: "local" },
      null,
      undefined,
      "core-work",
    );
    expect(started).toMatchObject({ session: "work", connection: "core-work" });
    h.finishSetup();
    const status = await settle(h.install, { type: "local" });
    expect(status).toMatchObject({ phase: "done", connection_id: "core-work" });
    expect(h.calls[0]!.input).toEndWith(
      "\nherdr_core_setup '' 'work' </dev/null\n",
    );
    expect(h.connected).toEqual(["core-work"]);
    expect(h.created).toHaveLength(0);
  });

  test("without a chosen connection only the default endpoint's connection is reused", async () => {
    const h = harness({
      coreProfiles: [
        {
          id: "core-work",
          type: "local",
          state: "error",
          core_session: "work",
        },
        {
          id: "core-custom",
          type: "local",
          state: "error",
          core_state_dir: "/example/state/herdr-core/default",
        },
      ],
    });
    h.install.install({ type: "local" }, null);
    h.finishSetup();
    const status = await settle(h.install, { type: "local" });
    expect(status.connection_id).toBe("core-local");
    expect(h.connected).toHaveLength(0);
    expect(h.created).toHaveLength(1);
  });

  test("a custom state directory or another host's connection is refused before anything runs", () => {
    const h = harness({
      coreProfiles: [
        {
          id: "core-custom",
          type: "local",
          state: "error",
          core_state_dir: "/example/state/herdr-core/default",
        },
        {
          id: "core-dev",
          type: "ssh",
          state: "error",
          ssh_destination: "dev.example.com",
        },
      ],
    });
    expect(() =>
      h.install.install({ type: "local" }, null, undefined, "core-custom"),
    ).toThrow("reads herdr-core from /example/state/herdr-core/default");
    expect(() =>
      h.install.install({ type: "local" }, null, undefined, "core-dev"),
    ).toThrow("not on this host");
    expect(() =>
      h.install.install({ type: "local" }, null, undefined, "missing"),
    ).toThrow("not on this host");
    expect(h.calls).toHaveLength(0);
    expect(h.install.status({ type: "local" }).phase).toBe("idle");
  });

  test("a core World cannot connect to is a failure in plain words, never done", async () => {
    const h = harness({
      connectsTo: {
        state: "reconnecting",
        error: { message: "herdr-core is not running" },
      },
    });
    h.install.install({ type: "local" }, null);
    h.finishSetup();
    const created = await settle(h.install, { type: "local" });
    expect(created.phase).toBe("failed");
    expect(created.error).toBe(
      "herdr-core is installed and started, but World could not connect to it: herdr-core is not running",
    );
    const existing = harness({
      coreProfiles: [{ id: "core-local", type: "local", state: "error" }],
      connectsTo: { state: "error" },
    });
    existing.install.install({ type: "local" }, null);
    existing.finishSetup();
    const reconnected = await settle(existing.install, { type: "local" });
    expect(reconnected.phase).toBe("failed");
    expect(reconnected.error).toContain("the connection is error");
  });
});
