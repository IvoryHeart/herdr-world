import { describe, expect, test } from "bun:test";
import type { ProcFs } from "../world/caller-identity";
import { CoreObservationStore } from "./observations";
import { localForegroundGroups, readForegroundGroup } from "./process-group";
import { createCoreConnectionRuntime } from "./runtime";
import { memoryStreamPair } from "./stream";
import { FakeCore } from "./testing/fake-core";
import { coreWorld } from "./testing/core-world";
import { CoreOperationFence } from "./fence";

type Proc = {
  pgrp: number;
  argv: string[];
  children?: number[];
  comm?: string;
  stdin?: string;
};

/** A synthetic /proc: pid → group, command line and children. */
function procFs(procs: Record<number, Proc>): ProcFs {
  const at = (path: string) => {
    const match = /^\/proc\/(\d+)\//.exec(path);
    const proc = match ? procs[Number(match[1])] : undefined;
    if (!proc) throw new Error(`ENOENT ${path}`);
    return proc;
  };
  return {
    read(path) {
      const proc = at(path);
      if (path.endsWith("/stat"))
        return `${path.split("/")[2]} (${proc.comm ?? "x) y"}) S 1 ${proc.pgrp} ${proc.pgrp} 34817 40`;
      if (path.endsWith("/cmdline")) return `${proc.argv.join("\0")}\0`;
      if (path.endsWith("/children"))
        return `${(proc.children ?? []).join(" ")} `;
      throw new Error(`ENOENT ${path}`);
    },
    list(path) {
      if (path === "/proc") return Object.keys(procs);
      at(path);
      return [path.split("/")[2]!];
    },
    link(path) {
      return at(path).stdin ?? "/dev/pts/1";
    },
  };
}

describe("a local core's foreground group, read on the host", () => {
  test("members are the leader's descendants in its group, nearest first", () => {
    const fs = procFs({
      40: { pgrp: 40, argv: ["bash", "run.sh"], children: [41, 42, 50] },
      41: {
        pgrp: 40,
        argv: ["node", "/opt/claude.js", "-p", "go"],
        children: [43],
      },
      42: { pgrp: 40, argv: ["tee", "log"] },
      43: { pgrp: 40, argv: ["git", "status"] },
      // A background job of the wrapper is in another group.
      50: { pgrp: 50, argv: ["codex"] },
    });
    expect(readForegroundGroup(40, "bash", fs)).toEqual([
      ["node", "/opt/claude.js", "-p", "go"],
      ["tee", "log"],
      ["git", "status"],
    ]);
  });

  test("input readers exclude pipe helpers but include their PTY-reading descendants", () => {
    const fs = procFs({
      40: { pgrp: 40, argv: ["claude"], children: [41, 42, 43] },
      41: {
        pgrp: 40,
        argv: ["sh", "-c", "mcp-server"],
        stdin: "pipe:[100]",
        children: [44],
      },
      42: { pgrp: 40, argv: ["python3", "mcp.py"], stdin: "pipe:[101]" },
      43: { pgrp: 43, argv: ["vim"] },
      44: { pgrp: 40, argv: ["vim"] },
      45: { pgrp: 40, argv: ["ssh", "example.invalid"] },
    });
    expect(readForegroundGroup(40, "claude", fs, true)).toEqual([
      ["claude"],
      ["vim"],
      ["ssh", "example.invalid"],
    ]);
    expect(readForegroundGroup(40, "claude", fs)).toContainEqual([
      "sh",
      "-c",
      "mcp-server",
    ]);
  });

  test("a pipe-connected leader is ignored while its PTY-reading agent child is admitted", () => {
    const fs = procFs({
      40: {
        pgrp: 40,
        argv: ["sh", "wrapper.sh"],
        stdin: "pipe:[100]",
        children: [41],
      },
      41: { pgrp: 40, argv: ["claude"] },
    });
    expect(readForegroundGroup(40, "sh", fs, true)).toEqual([[], ["claude"]]);
  });

  test("a pid that is not a readable group leader is unknown, not empty", () => {
    const fs = procFs({
      40: { pgrp: 39, argv: ["bash"] },
      41: { pgrp: 41, argv: ["bash"] },
    });
    expect(readForegroundGroup(40, undefined, fs)).toBeNull();
    expect(readForegroundGroup(99, undefined, fs)).toBeNull();
    expect(readForegroundGroup(1, undefined, fs)).toBeNull();
    // Not the program core reported: another namespace's pid, or a reused one.
    expect(readForegroundGroup(41, "zsh", fs)).toBeNull();
    // A leader with no children has an empty group: certainly no agent.
    expect(readForegroundGroup(41, "bash", fs)).toEqual([]);
  });

  test("only Linux has the host read", () => {
    expect(localForegroundGroups("darwin")).toBeUndefined();
    expect(typeof localForegroundGroups("linux")).toBe("function");
  });
});

describe("a local core's runtime looks inside a wrapper while one leads", () => {
  test("an agent that starts inside the group shows with no core event; it ends, and so does the reading", async () => {
    const fake = new FakeCore({ heartbeatMs: 60_000, version: "0.1.21" });
    fake.revive();
    const address = fake.create({
      foreground: { pid: 40, name: "bash", argv: ["bash", "run.sh"] },
    });
    let group: string[][] = [];
    let reads = 0;
    let changes = 0;
    const runtime = createCoreConnectionRuntime({
      identity: { id: "core", label: "core", source: "test" },
      context: { generation: 1, isCurrent: () => true, reportError: () => {} },
      transport: { open: async () => "memory", close: async () => {} },
      connect: async () => {
        const [server, world] = memoryStreamPair();
        fake.accept(server);
        return world;
      },
      observations: new CoreObservationStore(() => {}),
      onFailure: () => {},
      onReadModel: () => changes++,
      local: true,
      foregroundGroups: (leader, command) => {
        reads++;
        return leader === 40 && command === "bash" ? group : null;
      },
      groupRefreshMs: 5,
      publishDelayMs: 1,
    });
    const desk = async () => {
      const { panes } = await runtime.operations.listTerminals();
      const pane = (panes ?? []).find((p) => p.pane_id?.endsWith(address))!;
      return [pane.agent ?? null, pane.agent_status];
    };
    try {
      await runtime.startTransport();
      await runtime.startBackground();
      await until(() => reads > 0);
      expect(await desk()).toEqual([null, "unknown"]);
      // `claude -p` starts in the wrapper's group: core says nothing.
      const before = changes;
      group = [
        ["claude", "-p", "go"],
        ["tee", "log"],
      ];
      await until(() => changes > before);
      expect(await desk()).toEqual(["claude", "working"]);
      // The wrapper ends: the terminal's own shell leads, so reading stops.
      const root = fake.terminal(address)!.pid as number;
      fake.foreground(address, { pid: root, name: "bash", argv: ["bash"] });
      await until(async () => (await desk())[0] === null);
      const settled = reads;
      await Bun.sleep(30);
      expect(reads).toBe(settled);
    } finally {
      runtime.stop();
    }
  });

  test("a piped shell function leads its job as a copy of the interactive shell: World keeps reading, and a run that ends walks off", async () => {
    const fake = new FakeCore({ heartbeatMs: 60_000, version: "0.1.21" });
    fake.revive();
    // `f(){ claude -p …; read -r; }; f | cat`: the forked shell keeps its argv.
    const address = fake.create({
      foreground: {
        pid: 40,
        name: "bash",
        argv: ["bash", "--noprofile", "--norc", "-i"],
      },
    });
    let group: string[][] = [["cat"]];
    let reads = 0;
    let changes = 0;
    const runtime = createCoreConnectionRuntime({
      identity: { id: "core", label: "core", source: "test" },
      context: { generation: 1, isCurrent: () => true, reportError: () => {} },
      transport: { open: async () => "memory", close: async () => {} },
      connect: async () => {
        const [server, world] = memoryStreamPair();
        fake.accept(server);
        return world;
      },
      observations: new CoreObservationStore(() => {}),
      onFailure: () => {},
      onReadModel: () => changes++,
      local: true,
      foregroundGroups: (leader) => {
        reads++;
        return leader === 40 ? group : null;
      },
      groupRefreshMs: 5,
      publishDelayMs: 1,
    });
    const desk = async () => {
      const { panes } = await runtime.operations.listTerminals();
      const pane = (panes ?? []).find((p) => p.pane_id?.endsWith(address))!;
      return [pane.agent ?? null, pane.agent_status];
    };
    try {
      await runtime.startTransport();
      await runtime.startBackground();
      await until(() => reads > 0);
      expect(await desk()).toEqual([null, "unknown"]);
      // The run starts under the unchanged leader: no core event at all,
      // yet World publishes the change.
      let before = changes;
      group = [["claude", "-p", "go"], ["cat"]];
      await until(() => changes > before);
      expect(await desk()).toEqual(["claude", "working"]);
      // It exits; the function waits on `read`. The agent stays, idle: Town
      // walks it from the desk to the bar instead of dropping it.
      before = changes;
      group = [["cat"]];
      await until(() => changes > before);
      expect(await desk()).toEqual(["claude", "idle"]);
    } finally {
      runtime.stop();
    }
  });
});

async function until(predicate: () => boolean | Promise<boolean>, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(2);
  }
}

test("core delivers to a harness with pipe-connected helpers but blocks a PTY reader at final send", async () => {
  const procs: Record<number, Proc> = {
    40: { pgrp: 40, argv: ["claude"], children: [41, 42] },
    41: { pgrp: 40, argv: ["sh", "-c", "mcp-server"], stdin: "pipe:[100]" },
    42: { pgrp: 40, argv: ["python3", "mcp.py"], stdin: "pipe:[101]" },
  };
  const fs = procFs(procs);
  const w = await coreWorld({
    foregroundInputs: (leader, command) =>
      readForegroundGroup(leader, command, fs, true),
  });
  try {
    await w.connect();
    const address = w.fake.create({
      foreground: { pid: 40, name: "claude", argv: ["claude"] },
    });
    await w.settle();
    const lease = w.lease();
    const fence = CoreOperationFence.admit(lease, address);
    await lease.runtime.send(fence, "An answer", async () => true);
    expect(w.fake.deliveredInput).toHaveLength(1);
    await expect(
      lease.runtime.send(fence, "Another answer", async () => {
        procs[41]!.stdin = "/dev/pts/1";
        return true;
      }),
    ).rejects.toThrow("agent_not_ready:");
    expect(w.fake.deliveredInput).toHaveLength(1);
  } finally {
    await w.dispose();
  }
});
