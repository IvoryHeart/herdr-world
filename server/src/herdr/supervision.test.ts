import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  cgroupLeaf,
  detectServerSupervision,
  listeningSocketInodes,
  parentPid,
} from "./supervision";

const SOCKET = "/home/example/.config/herdr/herdr.sock";
const HEADER = "Num       RefCount Protocol Flags    Type St Inode Path\n";
const NET_UNIX = `${HEADER}0000: 00000002 00000000 00010000 0001 01 4242 ${SOCKET}\n0000: 00000003 00000000 00000000 0001 03 5151 ${SOCKET}\n`;

const trash: string[] = [];
afterEach(() => {
  for (const dir of trash.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

interface FakeProcess {
  inodes?: string[];
  cgroup?: string;
  ppid?: string;
  comm?: string;
}

/** A fake procfs: one listening socket and the processes around it. */
function fakeProc(processes: Record<string, FakeProcess>, netUnix = NET_UNIX) {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-proc-"));
  trash.push(root);
  mkdirSync(join(root, "net"));
  writeFileSync(join(root, "net", "unix"), netUnix);
  mkdirSync(join(root, "self"));
  for (const [pid, { inodes = [], cgroup, ppid, comm }] of Object.entries(
    processes,
  )) {
    mkdirSync(join(root, pid, "fd"), { recursive: true });
    symlinkSync("/dev/null", join(root, pid, "fd", "0"));
    inodes.forEach((inode, index) =>
      symlinkSync(
        `socket:[${inode}]`,
        join(root, pid, "fd", String(index + 3)),
      ),
    );
    if (cgroup) writeFileSync(join(root, pid, "cgroup"), cgroup);
    if (ppid)
      writeFileSync(
        join(root, pid, "stat"),
        `${pid} (${comm ?? "herdr"}) S ${ppid} ${pid} ${pid} 0 -1\n`,
      );
    if (comm) writeFileSync(join(root, pid, "comm"), `${comm}\n`);
  }
  return root;
}

const scope =
  "0::/user.slice/user-1.slice/user@1.service/app.slice/app-org.example.Terminal.slice/vte-spawn-0.scope\n";
const service =
  "0::/user.slice/user-1.slice/user@1.service/app.slice/herdr-world-herdr.service\n";
const userManager = { comm: "systemd" };

describe("procfs helpers", () => {
  test("find only the listening socket bound to the path", () => {
    expect([
      ...listeningSocketInodes(
        `${NET_UNIX}0000: 00000002 00000000 00010000 0001 01 6262 /tmp/other.sock\n`,
        SOCKET,
      ),
    ]).toEqual(["4242"]);
    expect(cgroupLeaf(scope)).toBe("vte-spawn-0.scope");
    expect(cgroupLeaf("0::/\n")).toBeNull();
    expect(cgroupLeaf("12:pids:/user.slice\n")).toBeNull();
    expect(parentPid("100 (herdr server) S 42 100 100 0 -1")).toBe("42");
    expect(parentPid("100 (a) b) S 7 100")).toBe("7");
  });
});

describe("detectServerSupervision on Linux", () => {
  test("a daemonized server in a terminal or login scope can hand off", async () => {
    for (const ppid of ["40", "1"]) {
      const procRoot = fakeProc({
        "100": { inodes: ["4242"], cgroup: scope, ppid },
        "40": userManager,
        // A connected client holds the other end, not the listener.
        "200": { inodes: ["5151"], cgroup: service, ppid: "40" },
      });
      expect(
        await detectServerSupervision(SOCKET, { platform: "linux", procRoot }),
      ).toBe("unsupervised");
    }
  });

  test("a server under a wrapper in that scope is not proven safe", async () => {
    // supervisord, runit and similar restart a child whose process exits.
    const procRoot = fakeProc({
      "100": { inodes: ["4242"], cgroup: scope, ppid: "90", comm: "herdr" },
      "90": { comm: "supervisord" },
    });
    expect(
      await detectServerSupervision(SOCKET, { platform: "linux", procRoot }),
    ).toBe("unknown");
  });

  test("a server in any systemd service is supervised, not only World's", async () => {
    for (const cgroup of [
      service,
      "0::/system.slice/herdr@example.service\n",
    ]) {
      const procRoot = fakeProc({
        "100": { inodes: ["4242"], cgroup, ppid: "1" },
      });
      expect(
        await detectServerSupervision(SOCKET, { platform: "linux", procRoot }),
      ).toBe("supervised");
    }
  });

  test("anything it cannot identify is unknown", async () => {
    for (const procRoot of [
      fakeProc({}), // no process visibly owns the socket
      fakeProc({
        "100": { inodes: ["4242"], cgroup: scope, ppid: "1" },
        "101": { inodes: ["4242"], cgroup: scope, ppid: "1" },
      }),
      fakeProc({ "100": { inodes: ["4242"], cgroup: "0::/\n", ppid: "1" } }),
      fakeProc({ "100": { inodes: ["4242"], ppid: "1" } }), // no cgroup
      fakeProc({ "100": { inodes: ["4242"], cgroup: scope } }), // no stat
      fakeProc(
        { "100": { inodes: ["4242"], cgroup: scope, ppid: "1" } },
        HEADER,
      ),
    ])
      expect(
        await detectServerSupervision(SOCKET, { platform: "linux", procRoot }),
      ).toBe("unknown");
    expect(
      await detectServerSupervision(SOCKET, {
        platform: "linux",
        procRoot: join(tmpdir(), "herdr-world-no-such-proc"),
      }),
    ).toBe("unknown");
  });
});

test("macOS and other platforms are never proven safe", async () => {
  // launchctl only lists the caller's domain and a job's main PID can be a
  // wrapper, so no unprivileged check proves a macOS server unsupervised.
  for (const platform of ["darwin", "win32", "freebsd"])
    expect(await detectServerSupervision(SOCKET, { platform })).toBe("unknown");
});
