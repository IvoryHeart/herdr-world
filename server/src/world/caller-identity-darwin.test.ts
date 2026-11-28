import { describe, expect, test } from "bun:test";
import {
  darwinCallerProcesses,
  type ProcessLookupCommand,
} from "./caller-identity-darwin";

const peer = { address: "127.0.0.1", port: 51000 };
const serverPort = 8790;
const socket = (
  pid = 400,
  local = "127.0.0.1:51000",
  remote = "127.0.0.1:8790",
  state = "ESTABLISHED",
) => `p${pid}\nf3\nn${local}->${remote}\nTST=${state}\n`;
const processes = "1 0 1\n200 1 200\n300 200 300\n400 300 300\n600 1 600\n";
const chain = [
  { pid: 400, ppid: 300, pgrp: 300 },
  { pid: 300, ppid: 200, pgrp: 300 },
  { pid: 200, ppid: 1, pgrp: 200 },
];
const lookup =
  (
    sockets: string | null = socket(),
    snapshot: string | null = processes,
  ): ProcessLookupCommand =>
  (file) =>
    file === "/usr/sbin/lsof" ? sockets : snapshot;

describe("macOS CLI caller lookup", () => {
  test("finds the client socket and ancestry with fixed bounded read-only commands", () => {
    const calls: unknown[] = [];
    const run: ProcessLookupCommand = (file, args, limits) => {
      calls.push({ file, args, limits });
      return lookup(
        socket(process.pid, "127.0.0.1:8790", "127.0.0.1:51000") + socket(),
      )(file, args, limits);
    };
    expect(darwinCallerProcesses(peer, serverPort, [200], run)).toEqual(chain);
    expect(calls).toEqual([
      {
        file: "/usr/sbin/lsof",
        args: ["-nP", "-a", "-iTCP:51000", "-sTCP:ESTABLISHED", "-FpnT"],
        limits: { timeout: 1000, maxBuffer: 262144 },
      },
      {
        file: "/bin/ps",
        args: ["-A", "-o", "pid=,ppid=,pgid="],
        limits: { timeout: 1000, maxBuffer: 262144 },
      },
    ]);
    expect(darwinCallerProcesses(peer, serverPort, [600], run)).toBeNull();
    // A shared process group alone cannot stand in for ancestry.
    expect(
      darwinCallerProcesses(
        peer,
        serverPort,
        [500],
        lookup(socket(), processes + "500 1 300\n"),
      ),
    ).toBeNull();
  });

  test("matches IPv4, IPv4-mapped and IPv6 addresses", () => {
    expect(
      darwinCallerProcesses(
        { ...peer, address: "::ffff:127.0.0.1" },
        serverPort,
        [200],
        lookup(),
      ),
    ).toEqual(chain);
    expect(
      darwinCallerProcesses(
        { ...peer, address: "::1" },
        serverPort,
        [200],
        lookup(socket(400, "[::1]:51000", "[::1]:8790")),
      ),
    ).toEqual(chain);
  });

  test("matches both client endpoint fields and a loopback destination", () => {
    for (const [local, remote, state] of [
      ["127.0.0.2:51000", "127.0.0.1:8790", "ESTABLISHED"],
      ["127.0.0.1:51001", "127.0.0.1:8790", "ESTABLISHED"],
      ["127.0.0.1:51000", "127.0.0.1:8791", "ESTABLISHED"],
      ["127.0.0.1:51000", "192.0.2.1:8790", "ESTABLISHED"],
      ["127.0.0.1:51000", "127.0.0.1:8790", "CLOSE_WAIT"],
      ["localhost:51000", "127.0.0.1:8790", "ESTABLISHED"],
    ]) {
      expect(
        darwinCallerProcesses(
          peer,
          serverPort,
          [200],
          lookup(socket(400, local, remote, state)),
        ),
      ).toBeNull();
    }
    // Another address using the same source port must not steal this caller.
    expect(
      darwinCallerProcesses(
        peer,
        serverPort,
        [200],
        lookup(socket() + socket(700, "127.0.0.2:51000")),
      ),
    ).toEqual(chain);
  });

  test("shared owners and ambiguous connections fail closed, duplicate descriptors do not", () => {
    for (const text of [
      socket() + socket(700),
      socket() + socket(400, "127.0.0.1:51000", "127.0.0.2:8790"),
    ])
      expect(
        darwinCallerProcesses(peer, serverPort, [200], lookup(text)),
      ).toBeNull();
    expect(
      darwinCallerProcesses(
        peer,
        serverPort,
        [200],
        lookup(socket() + socket()),
      ),
    ).toEqual(chain);
  });

  test("missing, malformed and unavailable process evidence stays unverified", () => {
    for (const text of [
      "",
      "not numeric",
      "400 300",
      "400 300 300\n400 200 300",
      "400 9007199254740992 300",
      "1 0 1",
      "400 300 300\n300 400 300",
      "400 400 300",
    ])
      expect(
        darwinCallerProcesses(peer, serverPort, [200], lookup(socket(), text)),
      ).toBeNull();
    for (const run of [
      lookup(null),
      lookup(socket(), null),
      () => {
        throw new Error("permission denied");
      },
    ])
      expect(darwinCallerProcesses(peer, serverPort, [200], run)).toBeNull();
    for (const text of [
      "",
      "p400\nn127.0.0.1:51000->127.0.0.1:8790\n",
      socket(process.pid),
      socket(0),
      socket(1),
    ])
      expect(
        darwinCallerProcesses(peer, serverPort, [200], lookup(text)),
      ).toBeNull();
  });

  test("rejects exhausted output, process and ancestry bounds", () => {
    const oversized = " ".repeat(262145);
    for (const run of [
      lookup(oversized),
      lookup(socket(), oversized),
      lookup(
        socket(),
        Array.from({ length: 4097 }, (_, i) => `${i + 1} 0 1`).join("\n"),
      ),
      lookup(
        socket(),
        Array.from({ length: 65 }, (_, i) => `${400 - i} ${399 - i} 300`).join(
          "\n",
        ),
      ),
    ])
      expect(darwinCallerProcesses(peer, serverPort, [400], run)).toBeNull();
  });

  test("invalid peers, ports and empty roots never start inspection", () => {
    let calls = 0;
    const run: ProcessLookupCommand = () => {
      calls++;
      return null;
    };
    for (const call of [
      { ...peer, address: "192.0.2.1" },
      { ...peer, port: 0 },
      { ...peer, port: 65536 },
      { ...peer, port: 1.5 },
    ])
      expect(darwinCallerProcesses(call, serverPort, [200], run)).toBeNull();
    expect(darwinCallerProcesses(peer, 0, [200], run)).toBeNull();
    expect(darwinCallerProcesses(peer, serverPort, [], run)).toBeNull();
    expect(calls).toBe(0);
  });
});
