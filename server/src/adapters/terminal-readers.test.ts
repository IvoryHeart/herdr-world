import { expect, test } from "bun:test";
import {
  localTerminalReaders,
  remoteTerminalReaders,
  terminalReaderEvidence,
} from "./terminal-readers";
import { runProcess } from "../utils/process-utils";

const stat = (group = 20, tty = 34817, foreground = 20) =>
  `21 (helper) S 20 ${group} 20 ${tty} ${foreground}`;
for (const [label, text, stdin, expected] of [
  ["PTY reader", stat(), "/dev/pts/1", true],
  ["MCP pipe", stat(), "pipe:[100]", false],
  ["socket helper", stat(), "socket:[101]", false],
  ["null stdin", stat(), "/dev/null", false],
  ["different PTY", stat(), "/dev/pts/2", false],
  ["background group", stat(21), "/dev/pts/1", false],
  ["stale foreground", stat(20, 34817, 21), "/dev/pts/1", false],
  ["no controlling PTY", stat(20, 0), "/dev/pts/1", false],
] as const)
  test(`reader evidence: ${label}`, () => {
    expect(terminalReaderEvidence(text, stdin, 20, "/dev/pts/1")).toBe(
      expected,
    );
  });

test("invalid stat evidence is unavailable", () => {
  expect(() => terminalReaderEvidence("bad", "/dev/pts/1", 20)).toThrow();
});

test("remote probe reads only validated PIDs on its qualified host", async () => {
  let command = "";
  const probe = remoteTerminalReaders(async (value) => {
    command = value;
    return `${stat()}\n/dev/pts/1\n${stat()}\npipe:[100]\n`;
  });
  const info = {
    tty: "/dev/pts/1",
    foreground_process_group_id: 20,
    foreground_processes: [{ pid: 20 }, { pid: 21 }],
  };
  expect(await probe(info)).toEqual([true, false]);
  expect(command).toContain("for pid in 20 21;");
  await expect(
    probe({ ...info, foreground_processes: [{ pid: "21; false" }] }),
  ).rejects.toThrow();
});

test("missing remote evidence fails closed", async () => {
  const probe = remoteTerminalReaders(async () => "");
  await expect(
    probe({
      tty: "/dev/pts/1",
      foreground_process_group_id: 20,
      foreground_processes: [{ pid: 20 }],
    }),
  ).rejects.toThrow();
});

test("remote command executes as POSIX shell syntax and a vanished PID fails", async () => {
  const probe = remoteTerminalReaders(
    async (command) => (await runProcess(["sh", "-c", command])).stdout,
  );
  await expect(
    probe({
      tty: "/dev/pts/1",
      foreground_process_group_id: 2147483647,
      foreground_processes: [{ pid: 2147483647 }],
    }),
  ).rejects.toThrow();
});

const linuxPtyTest =
  process.platform === "linux" && Bun.which("python3") ? test : test.skip;
linuxPtyTest(
  "real Linux PTY distinguishes a foreground harness from its pipe-connected helper",
  async () => {
    const script = `import os, pty, subprocess, json, sys, signal
pid, master = pty.fork()
if pid == 0:
    helper = subprocess.Popen(["sh", "-c", "read line"], stdin=subprocess.PIPE)
    print(json.dumps({"leader": os.getpid(), "helper": helper.pid, "tty": os.ttyname(0)}), flush=True)
    os.read(0, 1)
    os._exit(0)
try:
    line = b""
    while b"\\n" not in line:
        line += os.read(master, 1024)
    print(line.decode().strip(), flush=True)
    sys.stdin.readline()
finally:
    os.killpg(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    os.close(master)
`;
    const proc = Bun.spawn(["python3", "-c", script], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = proc.stdout.getReader();
      const chunk = await reader.read();
      reader.releaseLock();
      const info = JSON.parse(new TextDecoder().decode(chunk.value));
      expect(
        await localTerminalReaders({
          tty: info.tty,
          foreground_process_group_id: info.leader,
          foreground_processes: [{ pid: info.leader }, { pid: info.helper }],
        }),
      ).toEqual([true, false]);
    } finally {
      proc.stdin.write("\n");
      proc.stdin.end();
      expect(await proc.exited).toBe(0);
    }
  },
);
