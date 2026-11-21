import { expect, test } from "bun:test";
import { handoff, type HandoffPorts } from "./handoff";

function scenario(fail = "") {
  const calls: string[] = [];
  let live = "source";
  const step = async (name: string) => {
    calls.push(name);
    if (name === fail) throw new Error(name);
  };
  const ports: HandoffPorts = {
    prepare: () => step("prepare"),
    recheck: () => step("recheck"),
    quit: async () => {
      await step("quit");
      live = "none";
    },
    sourceStopped: async () => {
      await step("sourceStopped");
      return live !== "source";
    },
    resume: async () => {
      await step("resume");
      expect(live).toBe("none");
      live = "destination";
    },
    stopDestination: async () => {
      await step("stopDestination");
      live = "none";
    },
    rollback: async () => {
      await step("rollback");
      expect(live).toBe("none");
      live = "source";
    },
    transfer: () => step("transfer"),
    closeSource: () => step("closeSource"),
    cleanup: () => step("cleanup"),
  };
  return { calls, ports, live: () => live };
}

test("prepares and rechecks before quitting; closes source after resume and metadata", async () => {
  const s = scenario();
  expect((await handoff(s.ports)).status).toBe("moved");
  expect(s.calls).toEqual([
    "prepare",
    "recheck",
    "quit",
    "sourceStopped",
    "resume",
    "transfer",
    "closeSource",
    "cleanup",
  ]);
});

test.each(["prepare", "recheck"])(
  "%s failure leaves source running",
  async (point) => {
    const s = scenario(point);
    expect((await handoff(s.ports)).status).toBe("refused");
    expect(s.live()).toBe("source");
    expect(s.calls).not.toContain("quit");
  },
);

test.each(["resume", "transfer"])(
  "%s failure stops destination before rollback",
  async (point) => {
    const s = scenario(point);
    expect((await handoff(s.ports)).status).toBe("rolled_back");
    expect(s.calls.indexOf("stopDestination")).toBeLessThan(
      s.calls.indexOf("rollback"),
    );
    expect(s.live()).toBe("source");
    expect(s.calls).not.toContain("closeSource");
  },
);

test("an uncertain destination stop never starts another copy", async () => {
  const s = scenario("resume");
  s.ports.stopDestination = async () => {
    throw new Error("offline");
  };
  expect((await handoff(s.ports)).status).toBe("uncertain");
  expect(s.calls).not.toContain("rollback");
});

test("a lost quit acknowledgement is inspected rather than retried", async () => {
  const s = scenario("quit");
  expect((await handoff(s.ports)).status).toBe("refused");
  expect(s.calls.filter((c) => c === "quit")).toHaveLength(1);
  expect(s.live()).toBe("source");
});

test("source close failure keeps the verified destination running", async () => {
  const s = scenario("closeSource");
  expect((await handoff(s.ports)).status).toBe("moved");
  expect(s.live()).toBe("destination");
  expect(s.calls).not.toContain("rollback");
});

test("576 finite failure/acknowledgement combinations never run the conversation twice", async () => {
  let cases = 0;
  for (const quit of ["ok", "refused", "lost-before", "lost-after"])
    for (const resume of ["ok", "refused", "lost-before", "lost-after"])
      for (const stop of ["ok", "refused", "lost-after"])
        for (const rollback of ["ok", "refused", "lost-after"])
          for (const metadata of ["ok", "refused"])
            for (const close of ["ok", "refused"]) {
              let source = true,
                destination = false,
                destinationClosed = false;
              const safe = () =>
                expect(
                  Number(source) + Number(destination),
                ).toBeLessThanOrEqual(1);
              const outcome = await handoff({
                prepare: async () => {},
                recheck: async () => {},
                quit: async () => {
                  if (["ok", "lost-after"].includes(quit)) source = false;
                  safe();
                  if (quit !== "ok") throw new Error(quit);
                },
                sourceStopped: async () => !source,
                resume: async () => {
                  expect(source).toBe(false);
                  if (["ok", "lost-after"].includes(resume)) destination = true;
                  safe();
                  if (resume !== "ok") throw new Error(resume);
                },
                stopDestination: async () => {
                  if (["ok", "lost-after"].includes(stop)) {
                    destination = false;
                    destinationClosed = true;
                  }
                  safe();
                  if (stop !== "ok") throw new Error(stop);
                },
                rollback: async () => {
                  expect(destinationClosed).toBe(true);
                  expect(destination).toBe(false);
                  if (["ok", "lost-after"].includes(rollback)) source = true;
                  safe();
                  if (rollback !== "ok") throw new Error(rollback);
                },
                transfer: async () => {
                  if (metadata !== "ok") throw new Error(metadata);
                },
                closeSource: async () => {
                  expect(destination).toBe(true);
                  if (close !== "ok") throw new Error(close);
                },
                cleanup: async () => {},
              });
              safe();
              if (outcome.status === "moved") expect(destination).toBe(true);
              if (
                outcome.status === "rolled_back" ||
                outcome.status === "refused"
              )
                expect(source).toBe(true);
              cases++;
            }
  expect(cases).toBe(576);
});
