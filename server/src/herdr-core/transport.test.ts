import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreConnectionProfile } from "../connections/profiles";
import * as sshConfig from "../connections/ssh-profile-runtime";
import * as processes from "../utils/process-utils";
import * as tunnels from "../bridge/ssh-tunnel";
import {
  coreTransportForProfile,
  sshCoreTransport,
  type SshCoreTransportDependencies,
} from "./transport";
import { FakeCore } from "./testing/fake-core";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "core-transport-"));
  roots.push(root);
  const profile: CoreConnectionProfile = {
    id: "remote",
    label: "Remote",
    type: "ssh",
    runtime: "herdr-core",
    ssh_destination: "core.example",
    core_session: "custom",
    core_state_dir: join(root, "custom state"),
    auto_connect: false,
  };
  const config = {
    socketPath: join(root, "forward.sock"),
    clientSocketPath: "",
    sshHost: profile.ssh_destination,
    hasExplicitSocketPath: true,
    hasExplicitClientSocketPath: true,
  };
  return { root, profile, config };
}

test("profile selection opens the configured local core on Unix platforms", async () => {
  const { profile, root } = fixture();
  const fake = new FakeCore();
  const socket = await fake.listen(profile.core_state_dir, join(root, "run"));
  try {
    for (const platform of ["linux", "darwin"] as const) {
      const transport = coreTransportForProfile(
        { ...profile, type: "local" },
        { connectionId: "local", platform },
      );
      try {
        expect(await transport.open(new AbortController().signal)).toBe(socket);
      } finally {
        await transport.close();
      }
    }
  } finally {
    fake.kill(socket);
  }
});

test("SSH selection reads the custom remote state and opens only the forwarded local socket", async () => {
  const { profile, config } = fixture();
  const remote = "/synthetic/remote/core.sock";
  const reads: string[][] = [];
  const forwards: Parameters<typeof tunnels.createSshTunnelManager>[0][] = [];
  let started = 0,
    closed = 0;
  const dependencies: SshCoreTransportDependencies = {
    createConfig: () => config,
    readRemote: async (argv) => {
      reads.push(argv);
      return { code: 0, stdout: remote };
    },
    createTunnel: (args) => {
      forwards.push(args);
      return {
        startAutoSshTunnel: async () => {
          started++;
        },
        cleanupAutoSshTunnel: async () => {
          closed++;
        },
      };
    },
  };
  const failure = new tunnels.SshTunnelError(
    "tunnel ended",
    true,
    "exited",
    255,
  );
  const exits: Error[] = [];
  // These spies retain production profile selection; only host I/O is replaced.
  const configSpy = spyOn(
    sshConfig,
    "createSshProfileRuntimeConfig",
  ).mockImplementation(() => config);
  const readSpy = spyOn(
    processes,
    "runProcessWithCodeTimeout",
  ).mockImplementation(async (argv) => ({
    ...(await dependencies.readRemote!(argv)),
    stderr: "",
  }));
  const tunnelSpy = spyOn(tunnels, "createSshTunnelManager").mockImplementation(
    dependencies.createTunnel!,
  );
  let transport: ReturnType<typeof coreTransportForProfile> | undefined;
  try {
    transport = coreTransportForProfile(profile, {
      connectionId: "remote",
      onTunnelExit: (error) => exits.push(error),
      platform: "linux",
    });
    expect(await transport.open(new AbortController().signal)).toBe(
      config.socketPath,
    );
    expect(started).toBe(1);
    expect(reads[0]).toContain("core.example");
    expect(reads[0]!.join(" ")).toContain(profile.core_state_dir);
    expect(forwards[0]).toMatchObject({
      connectionId: "remote",
      config: {
        remoteSocketPath: remote,
        hasExplicitSocketPath: true,
        remoteClientSocketPath: undefined,
      },
    });
    forwards[0]!.onUnexpectedExit!(failure);
    expect(exits).toEqual([failure]);
  } finally {
    await transport?.close();
    configSpy.mockRestore();
    readSpy.mockRestore();
    tunnelSpy.mockRestore();
  }
  expect(closed).toBe(1);
});

test("cancellation during the remote lock read creates no SSH forward", async () => {
  const { profile, config } = fixture();
  const abort = new AbortController();
  let forwards = 0;
  const transport = sshCoreTransport(
    profile,
    { connectionId: "remote" },
    {
      createConfig: () => config,
      readRemote: async () => {
        abort.abort();
        return { code: 0, stdout: "/synthetic/remote/core.sock" };
      },
      createTunnel: () => {
        forwards++;
        return {
          startAutoSshTunnel: async () => {},
          cleanupAutoSshTunnel: async () => {},
        };
      },
    },
  );
  try {
    await expect(transport.open(abort.signal)).rejects.toThrow();
    expect(forwards).toBe(0);
  } finally {
    await transport.close();
  }
});
