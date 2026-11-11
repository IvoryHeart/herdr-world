import { describe, expect, test } from "bun:test";
import {
  coreConnectionStatus,
  coreProfilePayload,
  coreTerminalLabel,
  parseCoreConnections,
} from "./coreConnections";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "box-core",
  label: "Box core",
  type: "local",
  runtime: "herdr-core",
  state: "ready",
  generation: 3,
  core_session: "default",
  core_state_dir: "",
  auto_connect: true,
  read_only: false,
  observation: {
    state: "live",
    reason: null,
    core: { id: "c0ffee", name: "example-host", version: "0.1.20", pid: 41 },
    observed_ms: 1,
    cursor: 9,
    terminals: [
      {
        address: "t1",
        name: "agent",
        state: "live",
        status: "working",
        program: "claude",
        remote: false,
      },
      {
        address: "t2",
        name: null,
        state: "finished",
        status: null,
        program: "sh",
        remote: false,
      },
    ],
    counts: { live: 1, finished: 1, remote: 0 },
    unknown_events: [],
  },
  ...overrides,
});

describe("herdr-core connections in the browser", () => {
  test("parses only herdr-core items and keeps their observation", () => {
    const parsed = parseCoreConnections([
      item(),
      { ...item(), runtime: "herdr" },
      null,
      "x",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.observation?.terminals.map(coreTerminalLabel)).toEqual([
      "t1 agent · working",
      "t2 sh · ended",
    ]);
    const [windows, local] = parseCoreConnections([
      item({
        type: "ssh",
        ssh_destination: "dev@windows.example",
        remote_platform: "windows",
      }),
      item({ remote_platform: "windows" }),
    ]);
    expect(windows!.remote_platform).toBe("windows");
    expect(local!.remote_platform).toBeUndefined();
    expect(parseCoreConnections(undefined)).toEqual([]);
  });

  test("status reads live, stale while retrying, then not running", () => {
    const [live] = parseCoreConnections([item()]);
    expect(coreConnectionStatus(live!)).toBe(
      "Connected · herdr-core 0.1.20 · 1 live terminal",
    );
    const [stale] = parseCoreConnections([
      item({
        state: "reconnecting",
        observation: {
          ...item().observation,
          state: "stale",
          reason: "disconnected",
        },
      }),
    ]);
    expect(coreConnectionStatus(stale!)).toBe(
      "Stale · last saw 1 live terminal · retrying",
    );
    const [absent] = parseCoreConnections([
      item({ state: "reconnecting", observation: null }),
    ]);
    expect(coreConnectionStatus(absent!)).toBe("Not running · retrying");
    const [off] = parseCoreConnections([item({ state: "disconnected" })]);
    expect(coreConnectionStatus(off!)).toBe("Disconnected");
  });

  test("the add form builds a herdr-core profile and refuses bad input", () => {
    const base = {
      id: "wc",
      label: "Workstation core",
      where: "local" as const,
      sshDestination: "",
      session: "",
      stateDir: "",
      autoConnect: true,
    };
    expect(coreProfilePayload(base)).toEqual({
      id: "wc",
      label: "Workstation core",
      type: "local",
      runtime: "herdr-core",
      core_session: "default",
      core_state_dir: "",
      auto_connect: true,
    });
    expect(
      coreProfilePayload({
        ...base,
        where: "ssh",
        sshDestination: "dev@host.example",
      }),
    ).toMatchObject({
      type: "ssh",
      ssh_destination: "dev@host.example",
    });
    expect(() => coreProfilePayload({ ...base, where: "ssh" })).toThrow(
      "SSH destination",
    );
    expect(
      coreProfilePayload({
        ...base,
        where: "windows",
        sshDestination: "dev@windows.example",
        stateDir: String.raw`C:\Users\dev\state`,
      }),
    ).toEqual({
      id: "wc",
      label: "Workstation core",
      type: "ssh",
      runtime: "herdr-core",
      ssh_destination: "dev@windows.example",
      remote_platform: "windows",
      core_session: "default",
      core_state_dir: String.raw`C:\Users\dev\state`,
      auto_connect: true,
    });
    expect(() =>
      coreProfilePayload({
        ...base,
        where: "windows",
        sshDestination: "dev@windows.example",
        stateDir: "/home/dev/state",
      }),
    ).toThrow("Windows path");
    expect(() => coreProfilePayload({ ...base, where: "windows" })).toThrow(
      "SSH destination",
    );
    expect(() => coreProfilePayload({ ...base, session: "a;b" })).toThrow(
      "session",
    );
    expect(() => coreProfilePayload({ ...base, stateDir: "relative" })).toThrow(
      "absolute",
    );
  });
});
