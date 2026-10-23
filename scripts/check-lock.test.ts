import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireAllCheckSlots, acquireCheckSlot, HELD_ENV } from "./check-lock";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "check-lock-"));
  roots.push(root);
  return root;
}

/** A separate process that takes a slot, records when, holds, then exits. */
function holderScript(root: string) {
  const script = join(root, "holder.ts");
  writeFileSync(
    script,
    `import { appendFileSync } from "node:fs";
import { acquireAllCheckSlots, acquireCheckSlot } from ${JSON.stringify(join(import.meta.dir, "check-lock.ts"))};
const [dir, name, label, holdMs, record] = process.argv.slice(2);
const options = { lane: label, worktree: "worktree-" + label, dir, pollMs: 25, env: {} };
const release =
  name === "all"
    ? await acquireAllCheckSlots(options)
    : await acquireCheckSlot(name as "browser", options);
appendFileSync(record, JSON.stringify({ label, at: Date.now(), event: "start" }) + "\\n");
await Bun.sleep(Number(holdMs));
appendFileSync(record, JSON.stringify({ label, at: Date.now(), event: "end" }) + "\\n");
release();
`,
  );
  return (name: string, label: string, holdMs: number) =>
    Bun.spawn(
      [
        process.execPath,
        script,
        join(root, "locks"),
        name,
        label,
        String(holdMs),
        join(root, "record"),
      ],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "" } },
    );
}

function intervals(root: string) {
  const events = readFileSync(join(root, "record"), "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as { label: string; at: number; event: string },
    );
  const byLabel = new Map<string, { start: number; end: number }>();
  for (const event of events) {
    const entry = byLabel.get(event.label) ?? { start: 0, end: 0 };
    entry[event.event as "start" | "end"] = event.at;
    byLabel.set(event.label, entry);
  }
  return [...byLabel.values()].sort((a, b) => a.start - b.start);
}

test("two runs of a one-slot class take turns, and the second says whom it waits for", async () => {
  const root = scratch();
  const hold = holderScript(root);
  const first = hold("browser", "first", 600);
  await Bun.sleep(250);
  const second = hold("browser", "second", 50);
  const [, , output] = await Promise.all([
    first.exited,
    second.exited,
    new Response(second.stdout).text(),
  ]);
  const [a, b] = intervals(root);
  expect(b.start).toBeGreaterThanOrEqual(a.end);
  expect(output).toMatch(
    /\[queue\] second waiting for worktree-first first \(pid \d+, since \d{4}-\d\d-\d\dT[\d:.]+Z\)/,
  );
});

test("the light class runs two at a time and queues a third", async () => {
  const root = scratch();
  const hold = holderScript(root);
  const runs = [hold("light", "one", 500), hold("light", "two", 500)];
  await Bun.sleep(200);
  runs.push(hold("light", "three", 50));
  await Promise.all(runs.map((run) => run.exited));
  const [one, two, three] = intervals(root);
  expect(two.start).toBeLessThan(one.end); // the first two overlap
  expect(three.start).toBeGreaterThanOrEqual(Math.min(one.end, two.end));
});

test("a holder that dies leaves no stale lock", async () => {
  const root = scratch();
  const hold = holderScript(root);
  const victim = hold("browser", "victim", 60_000);
  for (let tries = 0; tries < 200 && !existsSync(join(root, "record")); tries++)
    await Bun.sleep(25);
  victim.kill("SIGKILL");
  await victim.exited;
  // The holder note still names the dead process; the kernel freed the lock.
  expect(readFileSync(join(root, "locks", "browser.0.json"), "utf8")).toContain(
    `"pid":${victim.pid}`,
  );
  const messages: string[] = [];
  const began = Date.now();
  const release = await acquireCheckSlot("browser", {
    lane: "next",
    dir: join(root, "locks"),
    env: {},
    pollMs: 25,
    log: (message) => messages.push(message),
  });
  expect(Date.now() - began).toBeLessThan(1000);
  expect(messages).toEqual([]);
  expect(readFileSync(join(root, "locks", "browser.0.json"), "utf8")).toContain(
    `"pid":${process.pid}`,
  );
  release();
});

test("children of a holder and CI runs never wait", async () => {
  const root = scratch();
  const dir = join(root, "locks");
  const release = await acquireCheckSlot("browser", {
    lane: "parent",
    dir,
    env: {},
  });
  try {
    for (const env of [{ [HELD_ENV]: "browser" }, { CI: "true" }]) {
      const began = Date.now();
      const inner = await acquireCheckSlot("browser", {
        lane: "child",
        dir,
        env,
        pollMs: 25,
        log: () => {
          throw new Error("must not wait");
        },
      });
      inner();
      expect(Date.now() - began).toBeLessThan(200);
    }
  } finally {
    release();
  }
});

test("a timed lane waits for every running heavy lane, and nothing starts beside it", async () => {
  const root = scratch();
  const hold = holderScript(root);
  // A unit lane is running when the timed lane asks for the whole machine.
  const unit = hold("light", "unit", 500);
  await Bun.sleep(200);
  const timed = hold("all", "timed", 500);
  await Bun.sleep(500);
  // A verification run arriving while the timed lane runs must wait.
  const verification = hold("verification", "verification", 50);
  await Promise.all([unit.exited, timed.exited, verification.exited]);
  const [first, second, third] = intervals(root);
  expect(second!.start).toBeGreaterThanOrEqual(first!.end);
  expect(third!.start).toBeGreaterThanOrEqual(second!.end);
});

test("two whole-machine lanes take turns without deadlock", async () => {
  const root = scratch();
  const hold = holderScript(root);
  const runs = [
    hold("all", "a", 200),
    hold("all", "b", 200),
    hold("light", "c", 200),
  ];
  const done = Promise.all(runs.map((run) => run.exited));
  const outcome = await Promise.race([
    done.then(() => "done"),
    Bun.sleep(5000).then(() => "stuck"),
  ]);
  expect(outcome).toBe("done");
  const spans = intervals(root);
  for (let i = 1; i < spans.length; i++)
    if (spans[i - 1]!.end > spans[i]!.start)
      // Only light lanes may overlap each other, never a whole-machine lane.
      throw new Error(`overlap: ${JSON.stringify(spans)}`);
});

test("children of a whole-machine holder do not queue again", async () => {
  const release = await acquireAllCheckSlots({
    lane: "child",
    env: { [HELD_ENV]: "browser" },
    dir: join(scratch(), "locks"),
  });
  release();
});
