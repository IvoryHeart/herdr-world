import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoreOperationFence } from "./fence";
import type { CoreMirrorTerminal } from "./mirror";
import { coreTaskEvents } from "./push";
import { createCoreConnectionRuntime } from "./runtime";
import {
  attentionFor,
  type CoreAlert,
  CoreAttention,
  favouriteToShare,
  isSharedLabelChange,
  seenToShare,
} from "./shared-state";
import { memoryStreamPair } from "./stream";
import type { CoreRecording } from "./testing/capture-core";
import { CoreObservationStore } from "./observations";
import { FrameDecoder, FrameKind } from "./wire";

const agent = (
  fields: Partial<Record<string, unknown>> = {},
): CoreMirrorTerminal =>
  ({
    address: "t1",
    argv: ["claude"],
    state: "live",
    labels: {},
    turn: 3,
    status: { state: "done" },
    remote: false,
    ...fields,
  }) as CoreMirrorTerminal;

describe("seen is raise-only (desktop app docs/labels.md)", () => {
  test("writes the looked-at turn when the label is missing or lower", () => {
    expect(seenToShare(agent(), 3, null)).toEqual({ "herdr.seen": "3" });
    expect(seenToShare(agent({ labels: { "herdr.seen": "2" } }), 3, 2)).toEqual(
      {
        "herdr.seen": "3",
      },
    );
    // A missing label is not 0: turn 0 still joins a terminal started elsewhere.
    expect(seenToShare(agent({ turn: 0 }), 0, null)).toEqual({
      "herdr.seen": "0",
    });
  });

  test("never lowers, never repeats and never runs ahead of core", () => {
    const seen = agent({ labels: { "herdr.seen": "3" } });
    expect(seenToShare(seen, 3, 3)).toBeNull();
    expect(seenToShare(seen, 2, 3)).toBeNull();
    expect(seenToShare(agent(), 4, null)).toBeNull();
    expect(seenToShare(agent(), -1, null)).toBeNull();
    expect(seenToShare(agent(), 1.5, null)).toBeNull();
  });

  test("a mark unread (turn − 1) is raised again only by a new look", () => {
    const unread = agent({ labels: { "herdr.seen": "2" } });
    expect(seenToShare(unread, 3, 2)).toEqual({ "herdr.seen": "3" });
  });

  test("another client's look or mark unread after World decided stands", () => {
    // Decided on a missing label; the phone has looked since.
    const looked = agent({ labels: { "herdr.seen": "2" } });
    expect(seenToShare(looked, 3, null)).toBeNull();
    // Decided on 3 - 1; the phone looked (3), then marked it unread (2) ...
    // and World never saw it move: the residual of core's missing CAS (Q7).
    expect(seenToShare(looked, 3, 2)).toEqual({ "herdr.seen": "3" });
    // Decided on 1; the phone has since marked turn 3 unread (2).
    expect(seenToShare(looked, 3, 1)).toBeNull();
  });

  test("only live local agents that report status", () => {
    expect(seenToShare(agent({ status: null }), 3, null)).toBeNull();
    expect(seenToShare(agent({ state: "finished" }), 3, null)).toBeNull();
    expect(
      seenToShare(agent({ remote: true, address: "m/t1" }), 3, null),
    ).toBeNull();
    expect(seenToShare(undefined, 3, null)).toBeNull();
  });
});

describe("favourite is herdr.pinned", () => {
  test("sets 1, removes by writing empty, and skips no-op writes", () => {
    expect(favouriteToShare(agent(), true)).toEqual({ "herdr.pinned": "1" });
    const pinned = agent({ labels: { "herdr.pinned": "yes" } });
    expect(favouriteToShare(pinned, true)).toBeNull();
    expect(favouriteToShare(pinned, false)).toEqual({ "herdr.pinned": "" });
    expect(favouriteToShare(agent(), false)).toBeNull();
    // A plain shell can be a favourite too; a gone one cannot.
    expect(favouriteToShare(agent({ status: null }), true)).not.toBeNull();
    expect(favouriteToShare(agent({ state: "finished" }), true)).toBeNull();
  });

  test("World's only label writes are these two keys", () => {
    expect(isSharedLabelChange({ "herdr.seen": "4" })).toBe(true);
    expect(isSharedLabelChange({ "herdr.pinned": "" })).toBe(true);
    for (const other of [
      { "herdr.space": "s1" },
      { "herdr.seen": "4", "herdr.pinned": "1" },
      { "herdr.seen": "-1" },
      { "herdr.pinned": "yes" },
      { where: "x" },
      {},
      null,
    ])
      expect(isSharedLabelChange(other)).toBe(false);
  });
});

describe("push follows Herdr's attention rule", () => {
  test("needing you alerts; finishing alerts only after being busy", () => {
    expect(attentionFor("working", "blocked")).toBe("blocked");
    expect(attentionFor("idle", "error")).toBe("blocked");
    expect(attentionFor(null, "blocked")).toBe("blocked");
    expect(attentionFor("blocked", "error")).toBeNull();
    expect(attentionFor("working", "done")).toBe("completed");
    expect(attentionFor("working", "idle")).toBe("completed");
    expect(attentionFor("blocked", "idle")).toBe("completed");
    expect(attentionFor("working", null)).toBeNull();
    expect(attentionFor("idle", "done")).toBeNull();
    expect(attentionFor(null, "working")).toBeNull();
  });

  test("first sight, replacements, sub-agents and linked machines are quiet", () => {
    const attention = new CoreAttention();
    expect(
      attention.cut("c1", [agent({ status: { state: "blocked" } })]),
    ).toEqual([]);
    const working = agent({ status: { state: "working" } });
    expect(attention.event("c1", "restarted", "t1", working)).toEqual([]);
    expect(attention.event("c1", "status", "t1", agent())).toEqual([
      { address: "t1", kind: "completed" },
    ]);
    const child = agent({ address: "t2", parent: "t1" });
    attention.event("c1", "created", "t2", { ...child, status: null });
    expect(
      attention.event("c1", "status", "t2", {
        ...child,
        status: { state: "blocked" },
      } as CoreMirrorTerminal),
    ).toEqual([]);
    // Another core under the same profile starts over.
    expect(attention.cut("c2", [agent()])).toEqual([]);
  });

  test("a turn that ended while disconnected alerts once, unless seen", () => {
    const attention = new CoreAttention();
    attention.cut("c1", [
      agent({ status: { state: "working" } }),
      agent({ address: "t2", status: { state: "working" } }),
    ]);
    const after = [
      agent({ turn: 4 }),
      agent({ address: "t2", turn: 4, labels: { "herdr.seen": "4" } }),
    ];
    expect(attention.cut("c1", after)).toEqual([
      { address: "t1", kind: "completed" },
    ]);
    expect(attention.cut("c1", after)).toEqual([]);
  });

  test("a whole turn inside the gap alerts, though the word reads the same", () => {
    // Done at turn 1 and seen; the agent works and finishes turn 2 while
    // World is away, so the reconnect cut reads done again with seen still 1.
    const seenAt1 = { "herdr.seen": "1" };
    const attention = new CoreAttention();
    attention.cut("c1", [
      agent({ turn: 1, labels: seenAt1 }),
      agent({ address: "t2", turn: 1, status: { state: "idle" } }),
      agent({ address: "t3", turn: 1, status: { state: "blocked" } }),
      agent({ address: "t4", turn: 1 }),
    ]);
    const after = [
      agent({ turn: 2, labels: seenAt1 }),
      agent({ address: "t2", turn: 2, status: { state: "idle" } }),
      // A new ask after working through another turn.
      agent({ address: "t3", turn: 2, status: { state: "blocked" } }),
      // Seen elsewhere already, or working on the next one: quiet.
      agent({ address: "t4", turn: 2, labels: { "herdr.seen": "2" } }),
    ];
    const alerts = attention.cut("c1", after);
    expect(alerts).toEqual([
      { address: "t1", kind: "completed" },
      { address: "t2", kind: "completed" },
      { address: "t3", kind: "blocked" },
    ]);
    expect(
      coreTaskEvents(alerts, after, "core").map((e) => [e.paneId, e.kind]),
    ).toEqual([
      ["t1", "completed"],
      ["t2", "completed"],
      ["t3", "blocked"],
    ]);
    expect(attention.cut("c1", after)).toEqual([]);
    const busyAgain = new CoreAttention();
    busyAgain.cut("c1", [agent({ turn: 1 })]);
    expect(
      busyAgain.cut("c1", [agent({ turn: 2, status: { state: "working" } })]),
    ).toEqual([]);
  });

  test("a turn already pushed from its event is not pushed again after a gap", () => {
    // Core sends the status event, then the turn event; World can lose the
    // connection between them, or after both.
    for (const turnEvent of [false, true]) {
      const attention = new CoreAttention();
      attention.cut("c1", [agent({ turn: 1, status: { state: "working" } })]);
      expect(attention.event("c1", "status", "t1", agent({ turn: 1 }))).toEqual(
        [{ address: "t1", kind: "completed" }],
      );
      if (turnEvent)
        expect(attention.event("c1", "turn", "t1", agent({ turn: 2 }))).toEqual(
          [],
        );
      expect(attention.cut("c1", [agent({ turn: 2 })])).toEqual([]);
      // The next whole turn inside a gap still alerts.
      expect(attention.cut("c1", [agent({ turn: 3 })])).toEqual([
        { address: "t1", kind: "completed" },
      ]);
    }
  });
});

// ---- Replay of World's traffic with a real herdr-core 0.1.20 ----

const recording: CoreRecording = JSON.parse(
  readFileSync(
    join(import.meta.dir, "testing/recorded/core-0.1.20-shared.json"),
    "utf8",
  ),
);

type RecordedFrame = {
  end: number;
  reply?: number;
  seq?: number;
};

/** The recorded inbound bytes, with where each framed message ends. */
function framesOf(bytes: Uint8Array): RecordedFrame[] {
  const frames: RecordedFrame[] = [{ end: bytes.indexOf(0x0a) + 1 }];
  const decoder = new FrameDecoder();
  let lines = "";
  for (let at = frames[0]!.end; at < bytes.byteLength; at++)
    for (const frame of decoder.push(bytes.subarray(at, at + 1))) {
      const text = new TextDecoder().decode(frame.payload);
      if (frame.channel === 0)
        frames.push({ end: at + 1, reply: JSON.parse(text).id });
      else {
        lines += text;
        const seqs = [...lines.matchAll(/"seq":(\d+)/g)].map((m) =>
          Number(m[1]),
        );
        lines = lines.slice(lines.lastIndexOf("\n") + 1);
        frames.push({ end: at + 1, seq: Math.max(-1, ...seqs) });
      }
    }
  return frames;
}

type Split = "recorded" | 1 | "random";

/**
 * A production core runtime fed the recorded bytes: each reply is released
 * when World sends its call, everything else when the test says, chunked
 * as recorded, byte by byte (UTF-8 and frame headers split) or at random.
 */
async function replayShared(split: Split) {
  const connection = recording.connections[0]!;
  const chunks = connection.inbound.map(
    (b) => new Uint8Array(Buffer.from(b, "base64")),
  );
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const frames = framesOf(bytes);
  const boundaries: number[] = [];
  let edge = 0;
  for (const chunk of chunks) boundaries.push((edge += chunk.byteLength));
  const [core, world] = memoryStreamPair();
  let released = 0;
  let random = 7;
  const release = (until: number) => {
    while (released < until) {
      let next: number;
      if (split === "recorded")
        next = Math.min(until, boundaries.find((b) => b > released)!);
      else if (split === 1) next = released + 1;
      else {
        random = (random * 1103515245 + 12345) % 2 ** 31;
        next = Math.min(until, released + 1 + (random % 61));
      }
      core.write(bytes.subarray(released, next));
      released = next;
    }
  };
  const through = (pick: (frame: RecordedFrame) => boolean) => {
    const frame = frames.find(pick);
    if (!frame) throw new Error("no such recorded frame");
    release(frame.end);
  };
  const calls: Array<{ method: string; params: unknown }> = [];
  const decoder = new FrameDecoder();
  let hello = false;
  core.onData((out) => {
    if (!hello) {
      hello = true;
      return release(frames[0]!.end);
    }
    for (const frame of decoder.push(out)) {
      if (frame.channel !== 0 || frame.kind !== FrameKind.DATA) continue;
      const call = JSON.parse(new TextDecoder().decode(frame.payload));
      calls.push({ method: call.method, params: call.params });
      queueMicrotask(() => through((f) => f.reply === call.id));
    }
  });
  const alerts: CoreAlert[] = [];
  let current = true;
  const runtime = createCoreConnectionRuntime({
    identity: { id: "recorded", label: "recorded", source: "test" },
    context: {
      generation: 1,
      isCurrent: () => current,
      reportError: () => {},
    },
    transport: { open: async () => "recorded", close: async () => {} },
    connect: async () => world,
    observations: new CoreObservationStore(() => {}),
    onFailure: () => {},
    onAlerts: (next) => alerts.push(...next),
    livenessIntervalMs: 3_600_000,
    publishDelayMs: 1,
  });
  await runtime.startTransport();
  await runtime.startBackground();
  const lease = {
    connectionId: "recorded",
    generation: 1,
    runtime,
    isCurrent: () => current,
  };
  const pane = async (address: string) =>
    (await runtime.operations.listTerminals()).panes!.find(
      (row) => row.pane_id === address,
    )!;
  const settle = () => Bun.sleep(2);
  return {
    calls,
    alerts,
    pane,
    settle,
    through,
    rest: () => release(bytes.byteLength),
    share: (
      address: string,
      decide: Parameters<typeof runtime.shareLabel>[1],
    ) => runtime.shareLabel(CoreOperationFence.admit(lease, address), decide),
    stop: async () => {
      current = false;
      core.close();
      await runtime.stop();
    },
    runtime,
  };
}

describe("recorded: seen and favourite with herdr-core 0.1.20", () => {
  for (const split of ["recorded", 1, "random"] as const)
    test(`World and another client share one truth (split ${split})`, async () => {
      const r = await replayShared(split);
      try {
        // The agent works, then finishes turn 1 while nobody looks: done.
        r.through((f) => f.seq === 4);
        await r.settle();
        expect((await r.pane("t1")).agent_status).toBe("done");
        expect(r.alerts).toEqual([{ address: "t1", kind: "completed" }]);
        r.through((f) => f.seq === 5);

        // World looks at turn 1: core accepts the label and done clears.
        expect(
          await r.share("t1", (record) => seenToShare(record, 1, null)),
        ).toBe("written");
        r.through((f) => f.seq === 6);
        await r.settle();
        expect(await r.pane("t1")).toMatchObject({
          agent_status: "idle",
          turn: 1,
          seen_turn: 1,
        });
        // Looking again at the same turn writes nothing.
        expect(await r.share("t1", (record) => seenToShare(record, 1, 1))).toBe(
          "unchanged",
        );

        // The other client marks it unread, then pins it: World follows.
        r.through((f) => f.seq === 7);
        await r.settle();
        expect(await r.pane("t1")).toMatchObject({
          agent_status: "done",
          seen_turn: 0,
        });
        r.through((f) => f.seq === 8);
        await r.settle();
        expect((await r.pane("t1")).favourite).toBe(true);

        // World unpins it: the label goes, the other labels stay.
        expect(
          await r.share("t1", (record) => favouriteToShare(record, false)),
        ).toBe("written");
        r.through((f) => f.seq === 9);
        await r.settle();
        expect((await r.pane("t1")).favourite).toBeUndefined();
        expect((await r.pane("t1")).agent_status).toBe("done");

        // A second agent stops to ask: one push, as needing you.
        r.rest();
        await r.settle();
        expect(r.alerts).toEqual([
          { address: "t1", kind: "completed" },
          { address: "t2", kind: "blocked" },
        ]);
        const events = coreTaskEvents(
          r.alerts,
          r.runtime.core.mirror.terminals(),
          "example-host",
        );
        expect(events.map((event) => [event.kind, event.paneId])).toEqual([
          ["completed", "t1"],
          ["blocked", "t2"],
        ]);

        // World's traffic is exactly what this core accepted.
        expect(r.calls).toEqual([
          { method: "server.status", params: {} },
          { method: "events.subscribe", params: {} },
          {
            method: "terminal.label",
            params: { terminal: "t1", labels: { "herdr.seen": "1" } },
          },
          {
            method: "terminal.label",
            params: { terminal: "t1", labels: { "herdr.pinned": "" } },
          },
        ]);
        expect(recording.connections[0]!.calls.slice(2)).toEqual([
          "terminal.label t1 herdr.seen=1",
          "terminal.label t1 herdr.pinned=",
        ]);
      } finally {
        await r.stop();
      }
    });
});
