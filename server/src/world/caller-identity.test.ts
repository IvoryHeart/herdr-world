import { describe, expect, test } from "bun:test";
import { callerProcesses, runsInPane, type ProcFs } from "./caller-identity";

const SERVER_PORT = 8790;
const hex = (port: number) => port.toString(16).toUpperCase().padStart(4, "0");
const row = (local: number, remote: number, inode: string, state = "01") =>
  `   0: 0100007F:${hex(local)} 0100007F:${hex(remote)} ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1`;

/** A synthetic /proc: one CLI (pid 400) under an agent (300) under a shell (200). */
function proc(overrides: Record<string, string> = {}): ProcFs {
  const files: Record<string, string> = {
    "/proc/net/tcp": [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      // The service's own end of the connection, then the CLI's end.
      row(SERVER_PORT, 51000, "777"),
      row(51000, SERVER_PORT, "778"),
      row(51001, SERVER_PORT, "779", "06"),
    ].join("\n"),
    "/proc/200/stat": "200 (bash) S 1 200 200",
    "/proc/300/stat": "300 (claude (code)) S 200 300 200",
    "/proc/400/stat": "400 (bun) S 300 300 200",
    ...overrides,
  };
  const links: Record<string, string> = {
    "/proc/400/fd/3": "socket:[778]",
    "/proc/500/fd/3": "socket:[777]",
  };
  return {
    read: (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`ENOENT ${path}`);
      return value;
    },
    list: (path) => {
      if (path === "/proc") return ["self", "200", "300", "400", "500"];
      const pid = path.match(/^\/proc\/(\d+)\/fd$/)?.[1];
      return pid && links[`/proc/${pid}/fd/3`] ? ["3"] : [];
    },
    link: (path) => {
      const value = links[path];
      if (!value) throw new Error(`ENOENT ${path}`);
      return value;
    },
  };
}

describe("the calling process", () => {
  test("is found from its loopback connection, with its ancestors", () => {
    expect(callerProcesses(51000, SERVER_PORT, proc())).toEqual([
      { pid: 400, ppid: 300, pgrp: 300 },
      { pid: 300, ppid: 200, pgrp: 300 },
      { pid: 200, ppid: 1, pgrp: 200 },
    ]);
  });

  test("is unknown for a closed connection or an unreadable /proc", () => {
    expect(callerProcesses(51001, SERVER_PORT, proc())).toBeNull();
    expect(
      callerProcesses(51000, SERVER_PORT, proc({ "/proc/net/tcp": "" })),
    ).toBeNull();
  });
});

describe("a pane claim", () => {
  const chain = callerProcesses(51000, SERVER_PORT, proc())!;

  test("holds when an ancestor is the pane's shell or foreground process", () => {
    expect(runsInPane(chain, { shell_pid: 200 })).toBe(true);
    expect(runsInPane(chain, { foreground_processes: [{ pid: 300 }] })).toBe(
      true,
    );
    expect(runsInPane(chain, { foreground_process_group_id: 300 })).toBe(true);
  });

  test("fails for another pane's processes: a spoofed HERDR_PANE_ID", () => {
    expect(
      runsInPane(chain, {
        shell_pid: 900,
        foreground_process_group_id: 901,
        foreground_processes: [{ pid: 901 }],
      }),
    ).toBe(false);
    expect(runsInPane(chain, null)).toBe(false);
    // PID 1 and missing groups never match.
    expect(
      runsInPane([{ pid: 400, ppid: 1, pgrp: 1 }], {
        foreground_process_group_id: 1,
        foreground_processes: [{ pid: 1 }],
      }),
    ).toBe(false);
  });
});
