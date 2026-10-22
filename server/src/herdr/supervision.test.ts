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
} from "./supervision";

const SOCKET = "/home/example/.config/herdr/herdr.sock";
const HEADER = "Num       RefCount Protocol Flags    Type St Inode Path\n";

const trash: string[] = [];
afterEach(() => {
  for (const dir of trash.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A fake procfs: one listening socket and the processes holding sockets. */
function fakeProc(
  processes: Record<string, { inodes: string[]; cgroup?: string }>,
  netUnix = `${HEADER}0000: 00000002 00000000 00010000 0001 01 4242 ${SOCKET}\n0000: 00000003 00000000 00000000 0001 03 5151 ${SOCKET}\n`,
) {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-proc-"));
  trash.push(root);
  mkdirSync(join(root, "net"));
  writeFileSync(join(root, "net", "unix"), netUnix);
  mkdirSync(join(root, "self"));
  for (const [pid, { inodes, cgroup }] of Object.entries(processes)) {
    mkdirSync(join(root, pid, "fd"), { recursive: true });
    symlinkSync("/dev/null", join(root, pid, "fd", "0"));
    inodes.forEach((inode, index) =>
      symlinkSync(
        `socket:[${inode}]`,
        join(root, pid, "fd", String(index + 3)),
      ),
    );
    if (cgroup) writeFileSync(join(root, pid, "cgroup"), cgroup);
  }
  return root;
}

const scope =
  "0::/user.slice/user-1.slice/user@1.service/app.slice/app-org.example.Terminal.slice/vte-spawn-0.scope\n";
const service =
  "0::/user.slice/user-1.slice/user@1.service/app.slice/herdr-world-herdr.service\n";

describe("procfs helpers", () => {
  test("find only the listening socket bound to the path", () => {
    expect([
      ...listeningSocketInodes(
        `${HEADER}0000: 00000002 00000000 00010000 0001 01 4242 ${SOCKET}\n0000: 00000003 00000000 00000000 0001 03 5151 ${SOCKET}\n0000: 00000002 00000000 00010000 0001 01 6262 /tmp/other.sock\n`,
        SOCKET,
      ),
    ]).toEqual(["4242"]);
    expect(cgroupLeaf(scope)).toBe("vte-spawn-0.scope");
    expect(cgroupLeaf("0::/\n")).toBeNull();
    expect(cgroupLeaf("12:pids:/user.slice\n")).toBeNull();
  });
});

describe("detectServerSupervision on Linux", () => {
  test("a server in a terminal or login scope can hand off", async () => {
    const procRoot = fakeProc({
      "100": { inodes: ["4242"], cgroup: scope },
      // A client connected to the server holds the other end, not the listener.
      "200": { inodes: ["5151"], cgroup: service },
    });
    expect(
      await detectServerSupervision(SOCKET, { platform: "linux", procRoot }),
    ).toBe("unsupervised");
  });

  test("a server in any systemd service is supervised, not only World's", async () => {
    for (const cgroup of [
      service,
      "0::/system.slice/herdr@example.service\n",
    ]) {
      const procRoot = fakeProc({ "100": { inodes: ["4242"], cgroup } });
      expect(
        await detectServerSupervision(SOCKET, { platform: "linux", procRoot }),
      ).toBe("supervised");
    }
  });

  test("anything it cannot identify is unknown", async () => {
    for (const procRoot of [
      fakeProc({}), // no process visibly owns the socket
      fakeProc({
        "100": { inodes: ["4242"], cgroup: scope },
        "101": { inodes: ["4242"], cgroup: scope },
      }),
      fakeProc({ "100": { inodes: ["4242"], cgroup: "0::/\n" } }), // no systemd
      fakeProc({ "100": { inodes: ["4242"] } }), // unreadable cgroup
      fakeProc({ "100": { inodes: ["4242"], cgroup: scope } }, HEADER),
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

describe("detectServerSupervision on macOS", () => {
  function run(lsof: string, launchctl: string, code = 0) {
    const calls: string[][] = [];
    return {
      calls,
      run: async (argv: string[]) => {
        calls.push(argv);
        return {
          code,
          stdout: argv[0] === "lsof" ? lsof : launchctl,
          stderr: "",
        };
      },
    };
  }
  const jobs =
    "PID\tStatus\tLabel\n-\t0\tcom.example.idle\n812\t0\tdev.herdr-world.herdr\n";

  test("a launchd job is supervised; an adopted daemon is not", async () => {
    const supervised = run("812\n", jobs);
    expect(
      await detectServerSupervision(SOCKET, {
        platform: "darwin",
        run: supervised.run,
      }),
    ).toBe("supervised");
    expect(supervised.calls).toEqual([
      ["lsof", "-t", "--", SOCKET],
      ["launchctl", "list"],
    ]);
    expect(
      await detectServerSupervision(SOCKET, {
        platform: "darwin",
        run: run("4711\n4711\n", jobs).run,
      }),
    ).toBe("unsupervised");
  });

  test("no single owner or a failing tool is unknown", async () => {
    for (const fake of [
      run("", jobs),
      run("1\n2\n", jobs),
      run("812\n", jobs, 1),
    ])
      expect(
        await detectServerSupervision(SOCKET, {
          platform: "darwin",
          run: fake.run,
        }),
      ).toBe("unknown");
  });

  test("other platforms are unknown", async () => {
    expect(await detectServerSupervision(SOCKET, { platform: "win32" })).toBe(
      "unknown",
    );
  });
});
