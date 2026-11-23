import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreEventLine } from "./client";
import { CoreMirror, type CoreMirrorTerminal } from "./mirror";
import { CoreAttention, waitsWithoutResult } from "./shared-state";
import type { HarnessStartRecording } from "./testing/capture-harness-start";
import { coreAgentStatus, CoreFirstSight, coreTopology } from "./topology";

/**
 * World starting Codex and Claude Code on a real herdr-core, recorded by
 * `testing/capture-harness-start.ts` (#1310): Codex reports working for a
 * moment while it starts, so core ends turn 1 before anyone asked it
 * anything; World's launch label `herdr.seen=0` then read it as done.
 */
const recording: HarnessStartRecording = JSON.parse(
  readFileSync(
    join(import.meta.dir, "testing/recorded/core-0.1.21-harness-start.json"),
    "utf8",
  ),
);

type Seen = {
  ms: number;
  seq: number;
  agents: Record<string, { agent: string; status: string }>;
  alerts: string[];
};

/** Plays the recording as World's runtime does, after every event. */
function replay(): Seen[] {
  const coreId = "c0ffee0000000001";
  const mirror = new CoreMirror();
  const firstSight = new CoreFirstSight();
  const attention = new CoreAttention();
  expect(mirror.baseline(0, [])).toBe(true);
  firstSight.observe(coreId, []);
  attention.cut(coreId, []);
  const seen: Seen[] = [];
  for (const { ms, line } of recording.events) {
    expect(mirror.apply(line as CoreEventLine)).toBe("applied");
    const { type, terminal, data, seq } = line.params as {
      type: string;
      terminal: string;
      data: unknown;
      seq: number;
    };
    if (type === "created") firstSight.observe(coreId, [data]);
    const alerts = attention
      .event(coreId, type, terminal, mirror.terminal(terminal))
      .map((alert) => `${alert.address} ${alert.kind}`);
    const { agents } = coreTopology(mirror.terminals(), "example-host", {
      firstSight,
      coreId,
    });
    seen.push({
      ms,
      seq,
      alerts,
      agents: Object.fromEntries(
        agents.map((row) => [
          String(row.terminal_id),
          { agent: String(row.agent), status: String(row.agent_status) },
        ]),
      ),
    });
  }
  return seen;
}

/** The event that ends a turn of `terminal` with `state`. */
function turnEnd(terminal: string, state: string) {
  const event = recording.events.find(({ line }) => {
    const p = line.params as {
      type: string;
      terminal: string;
      data: { state?: string };
    };
    return (
      p.type === "turn" && p.terminal === terminal && p.data.state === state
    );
  });
  if (!event) throw new Error(`no ${state} turn for ${terminal}`);
  return (event.line.params as { seq: number }).seq;
}

describe("a harness World starts on herdr-core (recorded)", () => {
  const seen = replay();
  const codexStarted = turnEnd("t1", "idle");
  const codexAnswered = turnEnd("t1", "done");
  const claudeAnswered = turnEnd("t2", "done");

  test("the recording is Codex's startup turn, then one real turn each", () => {
    expect(recording.core_version).toBe("0.1.21");
    expect(codexStarted).toBeLessThan(codexAnswered);
    expect(turnEnd("t2", "done")).toBeGreaterThan(codexStarted);
  });

  test("the wrapper never hides which harness runs", () => {
    for (const step of seen) {
      if (step.agents.t1) expect(step.agents.t1.agent).toBe("codex");
      if (step.agents.t2) expect(step.agents.t2.agent).toBe("claude");
    }
    expect(seen[0]?.agents.t1?.agent).toBe("codex");
  });

  test("each desk is idle within a few seconds, as its prompt shows", () => {
    const after = seen.find((step) => step.seq === codexStarted)!;
    expect(after.ms).toBeLessThan(5_000);
    expect(after.agents.t1?.status).toBe("idle");
    expect(after.agents.t2?.status).toBe("idle");
    // Until its message starts it working: idle stays idle, never done.
    const asked = recording.events.find(({ line }) => {
      const p = line.params as {
        seq: number;
        type: string;
        terminal: string;
        data: { status?: { state?: string } | null };
      };
      return (
        p.seq > codexStarted &&
        p.terminal === "t1" &&
        p.type === "status" &&
        p.data?.status?.state === "working"
      );
    });
    const askedSeq = (asked!.line.params as { seq: number }).seq;
    expect(askedSeq).toBeLessThan(codexAnswered);
    const waiting = seen.filter(
      (step) => step.seq >= codexStarted && step.seq < askedSeq,
    );
    expect(waiting.length).toBeGreaterThan(0);
    for (const step of waiting) expect(step.agents.t1?.status).toBe("idle");
  });

  test("starting is not finishing: no push for Codex's startup turn", () => {
    const startup = seen.filter((step) => step.seq <= codexStarted);
    expect(startup.flatMap((step) => step.alerts)).toEqual([]);
  });

  test("a real turn is still news: done until seen, and a push", () => {
    const end = seen.at(-1)!;
    expect(end.agents.t1?.status).toBe("done");
    expect(end.agents.t2?.status).toBe("done");
    expect(seen.flatMap((step) => step.alerts)).toEqual([
      "t2 completed",
      "t1 completed",
    ]);
    expect(claudeAnswered).toBeLessThan(codexAnswered);
  });
});

describe("waitsWithoutResult", () => {
  const record = (app: string, state: string, turn = 1) =>
    ({
      address: "t1",
      state: "live",
      status: { app, state },
      turn,
      labels: { "herdr.seen": "0" },
    }) as unknown as CoreMirrorTerminal;

  test("only harnesses that say done for a result", () => {
    expect(waitsWithoutResult(record("codex", "idle"))).toBe(true);
    expect(waitsWithoutResult(record("claude-code", "idle"))).toBe(true);
    expect(waitsWithoutResult(record("codex", "done"))).toBe(false);
    expect(coreAgentStatus(record("codex", "done"))).toBe("done");
  });

  test("another harness's idle turn above seen stays done (Herdr's rule)", () => {
    expect(waitsWithoutResult(record("gemini", "idle"))).toBe(false);
    expect(coreAgentStatus(record("gemini", "idle"))).toBe("done");
    expect(coreAgentStatus(record("codex", "idle"))).toBe("idle");
  });
});
