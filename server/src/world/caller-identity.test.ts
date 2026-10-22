import { describe, expect, test } from "bun:test";
import {
  addressKey,
  callerProcesses,
  runsInPane,
  type ProcFs,
} from "./caller-identity";

const SERVER_PORT = 8790;
const port = (value: number) =>
  value.toString(16).toUpperCase().padStart(4, "0");
/** IPv4 as /proc/net/tcp prints it: little-endian hex. */
const v4 = (address: string) =>
  address
    .split(".")
    .map((part) => Number(part).toString(16).toUpperCase().padStart(2, "0"))
    .reverse()
    .join("");
const row = (
  local: string,
  localPort: number,
  remote: string,
  remotePort: number,
  inode: string,
  state = "01",
) =>
  `   0: ${local}:${port(localPort)} ${remote}:${port(remotePort)} ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1`;
const HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const LOOP = v4("127.0.0.1");

/**
 * A synthetic /proc: a CLI (pid 400) under an agent (300) under a shell (200)
 * in one pane, and another pane's shell (600) with its own CLI (700).
 */
function proc(
  tcp: string[],
  links: Record<string, string> = {},
  tcp6: string[] = [],
): ProcFs {
  const files: Record<string, string> = {
    "/proc/net/tcp": [HEADER, ...tcp].join("\n"),
    "/proc/net/tcp6": [HEADER, ...tcp6].join("\n"),
    "/proc/200/stat": "200 (bash) S 1 200 200",
    "/proc/300/stat": "300 (claude (code)) S 200 300 200",
    "/proc/400/stat": "400 (bun) S 300 300 200",
    "/proc/600/stat": "600 (bash) S 1 600 600",
    "/proc/700/stat": "700 (bun) S 600 700 600",
  };
  const fds: Record<string, string> = {
    "/proc/400/fd/3": "socket:[778]",
    "/proc/700/fd/3": "socket:[880]",
    "/proc/500/fd/3": "socket:[777]",
    ...links,
  };
  return {
    read: (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`ENOENT ${path}`);
      return value;
    },
    list: (path) => {
      if (path === "/proc")
        return ["self", "200", "300", "400", "500", "600", "700"];
      const pid = path.match(/^\/proc\/(\d+)\/fd$/)?.[1];
      return Object.keys(fds)
        .filter((key) => key.startsWith(`/proc/${pid}/fd/`))
        .map((key) => key.split("/").pop()!);
    },
    link: (path) => {
      const value = fds[path];
      if (!value) throw new Error(`ENOENT ${path}`);
      return value;
    },
  };
}

const peer = (address: string, value: number) => ({ address, port: value });
const CHAIN = [
  { pid: 400, ppid: 300, pgrp: 300 },
  { pid: 300, ppid: 200, pgrp: 300 },
  { pid: 200, ppid: 1, pgrp: 200 },
];

describe("addresses", () => {
  test("IPv4, mapped and IPv6 forms compare equal when they are", () => {
    expect(addressKey("127.0.0.1")).toBe(addressKey("::ffff:127.0.0.1"));
    expect(addressKey("::1")).toBe("00000000000000000000000000000001");
    expect(addressKey("[::1]")).toBe(addressKey("0:0:0:0:0:0:0:1"));
    expect(addressKey("127.0.0.2")).not.toBe(addressKey("127.0.0.1"));
    expect(addressKey("not an address")).toBeNull();
  });
});

describe("the calling process", () => {
  test("is found from its own connection, with its ancestors", () => {
    const fs = proc([
      // The service's end of the connection, then the CLI's end.
      row(LOOP, SERVER_PORT, LOOP, 51000, "777"),
      row(LOOP, 51000, LOOP, SERVER_PORT, "778"),
    ]);
    expect(callerProcesses(peer("127.0.0.1", 51000), SERVER_PORT, fs)).toEqual(
      CHAIN,
    );
    // The same connection seen through an IPv4-mapped peer address.
    expect(
      callerProcesses(peer("::ffff:127.0.0.1", 51000), SERVER_PORT, fs),
    ).toEqual(CHAIN);
  });

  test("a connection from another address on the same port is its own caller", () => {
    // Pane B's CLI holds 127.0.0.1:51000; pane A's connects from
    // 127.0.0.2:51000 hoping to be taken for it.
    const fs = proc([
      row(LOOP, 51000, LOOP, SERVER_PORT, "778"),
      row(v4("127.0.0.2"), 51000, LOOP, SERVER_PORT, "880"),
    ]);
    expect(
      callerProcesses(peer("127.0.0.2", 51000), SERVER_PORT, fs)?.[0]?.pid,
    ).toBe(700);
  });

  test("an ambiguous connection or a shared socket fails closed", () => {
    // Two rows match the peer's address and port (two server addresses).
    const twice = proc([
      row(LOOP, 51000, LOOP, SERVER_PORT, "778"),
      row(LOOP, 51000, v4("127.0.0.3"), SERVER_PORT, "880"),
    ]);
    expect(
      callerProcesses(peer("127.0.0.1", 51000), SERVER_PORT, twice),
    ).toBeNull();
    // An inherited descriptor: two processes hold the socket.
    const shared = proc([row(LOOP, 51000, LOOP, SERVER_PORT, "778")], {
      "/proc/700/fd/4": "socket:[778]",
    });
    expect(
      callerProcesses(peer("127.0.0.1", 51000), SERVER_PORT, shared),
    ).toBeNull();
  });

  test("an IPv6 loopback connection is read from tcp6", () => {
    const fs = proc([], {}, [
      row(
        "00000000000000000000000001000000",
        51000,
        "00000000000000000000000001000000",
        SERVER_PORT,
        "778",
      ),
    ]);
    expect(callerProcesses(peer("::1", 51000), SERVER_PORT, fs)).toEqual(CHAIN);
  });

  test("is unknown for a closed connection or an unreadable /proc", () => {
    expect(
      callerProcesses(
        peer("127.0.0.1", 51000),
        SERVER_PORT,
        proc([row(LOOP, 51000, LOOP, SERVER_PORT, "778", "06")]),
      ),
    ).toBeNull();
    expect(
      callerProcesses(peer("127.0.0.1", 51000), SERVER_PORT, proc([])),
    ).toBeNull();
  });
});

describe("a pane claim", () => {
  test("holds when an ancestor is the pane's shell or foreground process", () => {
    expect(runsInPane(CHAIN, { shell_pid: 200 })).toBe(true);
    expect(runsInPane(CHAIN, { foreground_processes: [{ pid: 300 }] })).toBe(
      true,
    );
  });

  test("fails for another pane's processes: a spoofed HERDR_PANE_ID", () => {
    expect(
      runsInPane(CHAIN, {
        shell_pid: 900,
        foreground_process_group_id: 901,
        foreground_processes: [{ pid: 901 }],
      }),
    ).toBe(false);
    expect(runsInPane(CHAIN, null)).toBe(false);
    // A shared process group alone is not enough, and PID 1 never matches.
    expect(runsInPane(CHAIN, { foreground_process_group_id: 300 })).toBe(false);
    expect(
      runsInPane([{ pid: 400, ppid: 1, pgrp: 1 }], {
        shell_pid: 1,
        foreground_processes: [{ pid: 1 }],
      }),
    ).toBe(false);
  });
});
