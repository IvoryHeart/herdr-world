import { expect, test } from "bun:test";
import {
  createHostDiscoverer,
  HostDiscoveryError,
  RUNTIME_PROVIDERS,
} from "./host-discovery";
import { hostId, type HostProfile } from "./hosts";
import type { ConnectionProfile } from "./profiles";

function remote(windows = false): HostProfile {
  const target = {
    type: "ssh" as const,
    ssh_destination: "sample@host.example",
  };
  return {
    ...target,
    id: hostId(target),
    label: "Example",
    auto_connect: true,
    ...(windows ? { remote_platform: "windows" as const } : {}),
  };
}

test.each([false, true])(
  "SSH discovery uses only each registered fixed probe (Windows: %s)",
  async (windows) => {
    const commands: string[][] = [];
    const host = remote(windows);
    const discover = createHostDiscoverer(
      RUNTIME_PROVIDERS,
      async (argv, timeout) => {
        commands.push(argv);
        expect(timeout).toBe(12_000);
        expect(argv).toContain("BatchMode=yes");
        expect(argv).toContain("StrictHostKeyChecking=yes");
        expect(argv).toContain("PermitLocalCommand=no");
        expect(argv.slice(-2, -1)).toEqual([host.ssh_destination!]);
        return { code: 0, stdout: "found\nHerdr 1.2.3\n", stderr: "" };
      },
    );
    const found = await discover(host, []);
    expect(found).toHaveLength(2);
    expect(found.map((runtime) => runtime.profile.id)).toEqual(
      RUNTIME_PROVIDERS.map((provider) => `${host.id}-${provider.kind}`),
    );
    expect(found.map((runtime) => runtime.version)).toEqual(["1.2.3", "1.2.3"]);
    expect(commands.map((argv) => argv.at(-1))).toEqual(
      RUNTIME_PROVIDERS.map((provider) =>
        windows ? provider.windowsProbe : provider.posixProbe,
      ),
    );
    expect(JSON.stringify(found)).not.toContain("ssh_options");
  },
);

test("every provider is checked even when the first is installed", async () => {
  let calls = 0;
  const found = await createHostDiscoverer(RUNTIME_PROVIDERS, async () => ({
    code: 0,
    stdout: ++calls === 1 ? "found\n0.1.2" : "absent\n",
    stderr: "",
  }))(remote(), []);
  expect(calls).toBe(2);
  expect(found).toHaveLength(1);
});

test("a legacy profile named like a different provider cannot capture the newly discovered runtime", async () => {
  const host = remote();
  const legacy: ConnectionProfile = {
    id: `${host.id}-herdr-core`,
    label: "Legacy TUI",
    type: "ssh",
    ssh_destination: host.ssh_destination!,
    remote_control_socket_path: "",
    remote_client_socket_path: "",
    auto_connect: true,
  };
  const found = await createHostDiscoverer(
    RUNTIME_PROVIDERS.slice(0, 1),
    async () => ({ code: 0, stdout: "found\n1.2.3", stderr: "" }),
  )(host, [legacy]);
  expect(found[0]!.profile.id).toBe(`${host.id}-herdr-core-2`);
});

test("discovery preserves all configured runtime/session IDs on the same destination", async () => {
  const host = remote();
  const profiles: ConnectionProfile[] = ["core-default", "core-other"].map(
    (id) => ({
      id,
      label: id,
      type: "ssh",
      runtime: "herdr-core",
      ssh_destination: host.ssh_destination,
      core_session: id === "core-default" ? "default" : "other",
      core_state_dir: "",
      auto_connect: false,
    }),
  );
  const found = await createHostDiscoverer(
    RUNTIME_PROVIDERS.slice(0, 1),
    async () => ({ code: 0, stdout: "found\n0.1.2", stderr: "" }),
  )(host, profiles);
  expect(found.map((runtime) => runtime.profile)).toEqual(profiles);
});

test("a new provider entry participates in discovery and the provider's default profile", async () => {
  const provider = {
    ...RUNTIME_PROVIDERS[1]!,
    kind: "additional",
    label: "Additional runtime",
    posixProbe: "printf 'found\\n1.0.0'",
  };
  const found = await createHostDiscoverer([provider], async (argv) => {
    expect(argv.at(-1)).toBe(provider.posixProbe);
    return { code: 0, stdout: "found\n1.0.0", stderr: "" };
  })(remote(), []);
  expect(found[0]!.profile.id).toBe(`${remote().id}-additional`);
  expect(found[0]!.kind).toBe("additional");
});

test.each([
  "sample@host.example;id",
  "-oProxyCommand=anything",
  "host.example $(id)",
  "ssh://host.example",
  "host.example\nwhoami",
])(
  "unsafe SSH destination is refused before any probe: %s",
  async (destination) => {
    let calls = 0;
    await expect(
      createHostDiscoverer(RUNTIME_PROVIDERS, async () => {
        calls++;
        return { code: 0, stdout: "absent", stderr: "" };
      })({ ...remote(), ssh_destination: destination }, []),
    ).rejects.toBeInstanceOf(HostDiscoveryError);
    expect(calls).toBe(0);
  },
);

test("a failed or malformed probe is incomplete evidence, preserving successful siblings", async () => {
  let calls = 0;
  try {
    await createHostDiscoverer(RUNTIME_PROVIDERS, async () => ({
      code: 0,
      stdout: ++calls === 1 ? "not a discovery reply" : "found\n1.2.3",
      stderr: "",
    }))(remote(), []);
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(HostDiscoveryError);
    const partial = error as HostDiscoveryError;
    expect(partial.checkedKinds).toEqual(["herdr"]);
    expect(partial.found).toHaveLength(1);
    expect(partial.found[0]!.profile.id).toBe(`${remote().id}-herdr`);
  }
});

test("a local binary path is an argv entry and version detection never invokes a shell", async () => {
  const provider = {
    ...RUNTIME_PROVIDERS[1]!,
    localBinary: () => "/synthetic path/herdr",
  };
  const discover = createHostDiscoverer([provider], async (argv, timeout) => {
    expect(argv).toEqual(["/synthetic path/herdr", "--version"]);
    expect(timeout).toBe(5000);
    return { code: 0, stdout: "herdr 1.2.3\n", stderr: "" };
  });
  expect(
    (
      await discover(
        {
          id: "host-local",
          label: "This computer",
          type: "local",
          auto_connect: true,
        },
        [],
      )
    )[0]?.version,
  ).toBe("1.2.3");
});
