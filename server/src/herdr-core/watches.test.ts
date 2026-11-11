import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager } from "../connections/manager";
import { CoreObservationStore } from "./observations";
import {
  type CoreConnectionRuntime,
  createCoreConnectionRuntime,
} from "./runtime";
import { FakeCore } from "./testing/fake-core";
import { localCoreTransport } from "./transport";
import { type CoreTerminalPush, CoreTerminalWatches } from "./watches";
import { FrameKind, STREAM_WINDOW } from "./wire";

const roots: string[] = [];
const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(2);
  }
}

type Page = { pushes: CoreTerminalPush[]; buffered: number; open: boolean };

/** One core connection (production runtime) and World's watch relay. */
async function served() {
  const root = mkdtempSync(join(tmpdir(), "hcw-w-"));
  roots.push(root);
  const fake = new FakeCore({ heartbeatMs: 60_000 });
  const stateDir = join(root, "state");
  const socket = await fake.listen(stateDir, join(root, "run"));
  const manager = new ConnectionManager<CoreConnectionRuntime>("");
  manager.register({
    identity: { id: "core", label: "core", source: "local-profile" },
    createRuntime: (context) =>
      createCoreConnectionRuntime({
        identity: { id: "core", label: "core", source: "local-profile" },
        context,
        transport: localCoreTransport(stateDir),
        observations: new CoreObservationStore(() => {}),
        onFailure: () => {},
      }),
  });
  stops.push(() => manager.stopAll());
  stops.push(() => fake.kill(socket));
  await manager.start("core");
  const watches = new CoreTerminalWatches<Page>({
    lease: (id) => (manager.has(id) ? manager.readyRuntimeLease(id) : null),
    send: (page, push) => {
      if (!page.open) return false;
      page.pushes.push(push);
      return true;
    },
    buffered: (page) => page.buffered,
    limits: { perSocket: 2 },
  });
  stops.push(() => watches.stop());
  const page = (): Page => ({ pushes: [], buffered: 0, open: true });
  /** World's mirror has applied the terminal's creation. */
  const seen = (address: string) =>
    until(
      () =>
        manager.readyRuntimeLease("core")?.runtime.core.terminal(address)
          ?.state === "live",
    );
  const target = (address: string, stream = "s1") => ({
    connection_id: "core",
    generation: manager.status("core").generation,
    address,
    stream,
  });
  return { fake, socket, manager, watches, page, target, seen };
}

const bytesOf = (pushes: CoreTerminalPush[]) =>
  pushes.reduce(
    (n, p) => n + ("bytes" in p ? Buffer.from(p.bytes, "base64").length : 0),
    0,
  );
const kinds = (pushes: CoreTerminalPush[]) =>
  pushes.map((p) => ("grid" in p ? "grid" : "bytes" in p ? "bytes" : "closed"));

describe("World's watches of core terminals", () => {
  test("a page receives the owner's grid before the paint; leaving detaches", async () => {
    const w = await served();
    const t = w.fake.create({ name: "agent" });
    await w.seen(t);
    w.fake.output(t, "ready ✓\r\n");
    w.fake.desktopAttach(t, 132, 40);
    await until(() => w.manager.readyRuntimeLease("core") !== null);
    await until(
      () =>
        w.manager.readyRuntimeLease("core")!.runtime.core.terminal(t)?.cols ===
        132,
    );
    const page = w.page();
    const opened = await w.watches.open(page, w.target(t));
    expect(opened).toEqual({
      stream: "s1",
      grid: { cols: 132, rows: 40 },
      moved_from: null,
    });
    await until(() => page.pushes.length >= 2);
    expect(page.pushes[0]).toEqual({
      stream: "s1",
      grid: { cols: 132, rows: 40 },
    });
    expect(
      Buffer.from(
        (page.pushes[1] as { bytes: string }).bytes,
        "base64",
      ).toString(),
    ).toContain("ready ✓");
    expect(w.watches.size).toBe(1);
    expect(w.watches.close(page, "s1")).toBe(true);
    await until(() => w.fake.viewersOf(t).length === 0);
    // Watching and leaving never sized it, and sent nothing but CLOSE.
    expect(w.fake.terminal(t)).toMatchObject({ cols: 132, rows: 40 });
    expect(w.fake.viewerFrames.map((f) => f.kind)).toEqual([FrameKind.CLOSE]);
    expect(w.watches.size).toBe(0);
  });

  test("a page whose socket is behind stops crediting core until it drains", async () => {
    const w = await served();
    const t = w.fake.create({ name: "agent" });
    await w.seen(t);
    const page = w.page();
    await w.watches.open(page, w.target(t));
    await until(() => page.pushes.length >= 2);
    page.buffered = 4 << 20;
    const line = `${"y".repeat(1023)}\n`;
    for (let i = 0; i < 600; i++) w.fake.output(t, line);
    await Bun.sleep(30);
    const stalled = bytesOf(page.pushes);
    // Core stops at its window: World never queued the backlog for the page.
    expect(stalled).toBeLessThanOrEqual(STREAM_WINDOW + 20_000);
    expect(stalled).toBeLessThan(600 * 1024);
    page.buffered = 0;
    w.watches.drained(page);
    await until(() => bytesOf(page.pushes) > stalled);
    w.watches.release(page);
  });

  test("a replaced program ends the watch; the page is told why", async () => {
    const w = await served();
    const t = w.fake.create({ name: "agent", keep: true });
    await w.seen(t);
    const page = w.page();
    await w.watches.open(page, w.target(t));
    w.fake.replaceWithShell(t);
    await until(() => page.pushes.some((p) => "closed" in p));
    expect(page.pushes.filter((p) => "closed" in p)).toHaveLength(1);
    expect(w.watches.size).toBe(0);
    // A fresh watch is a fresh admission of the new program.
    await w.watches.open(page, w.target(t, "s2"));
    expect(w.watches.size).toBe(1);
  });

  test("kill -9 mid-stream: the page is told, the old generation is refused, a new one watches", async () => {
    const w = await served();
    const t = w.fake.create({ name: "agent" });
    await w.seen(t);
    w.fake.desktopAttach(t, 100, 30);
    const page = w.page();
    const old = w.target(t);
    await w.watches.open(page, old);
    w.fake.output(t, "streaming…");
    w.fake.kill(w.socket);
    await until(() => page.pushes.some((p) => "closed" in p));
    expect(w.watches.size).toBe(0);
    // Not actionable until the supervisor retires it, then a new generation.
    await expect(
      w.watches.open(page, { ...old, stream: "s2" }),
    ).rejects.toThrow(/connection changed|not-actionable/);
    // The holder-respawned core: same terminal, same address, same grid.
    w.fake.revive();
    await w.fake.listen(join(roots[0]!, "state"), join(roots[0]!, "run"));
    await w.manager.stop("core");
    await w.manager.start("core");
    await expect(
      w.watches.open(page, { ...old, stream: "s4" }),
    ).rejects.toThrow("connection changed");
    await w.seen(t);
    const fresh = w.page();
    await w.watches.open(fresh, w.target(t, "s3"));
    await until(() => fresh.pushes.length >= 2);
    expect(kinds(fresh.pushes).slice(0, 2)).toEqual(["grid", "bytes"]);
    expect(fresh.pushes[0]).toMatchObject({ grid: { cols: 100, rows: 30 } });
  });

  test("the observer-alone exception is reported, not hidden", async () => {
    const w = await served();
    const t = w.fake.create({ name: "quiet", cols: 100, rows: 30 });
    await w.seen(t);
    await until(() => w.manager.readyRuntimeLease("core") !== null);
    const opened = await w.watches.open(w.page(), w.target(t));
    expect(opened).toMatchObject({
      grid: { cols: 200, rows: 120 },
      moved_from: { cols: 100, rows: 30 },
    });
  });

  test("refuses what it cannot fence: other connections, linked machines, stale generations, too many", async () => {
    const w = await served();
    const t = w.fake.create({ name: "agent" });
    await w.seen(t);
    const page = w.page();
    await expect(
      w.watches.open(page, { ...w.target(t), connection_id: "other" }),
    ).rejects.toThrow("connection changed");
    await expect(
      w.watches.open(page, { ...w.target(t), address: "box/t1" }),
    ).rejects.toThrow("not a local terminal address");
    await expect(
      w.watches.open(page, { ...w.target(t), generation: 99 }),
    ).rejects.toThrow("connection changed");
    await expect(
      w.watches.open(page, { ...w.target(t), stream: "has space" }),
    ).rejects.toThrow("stream key");
    await expect(
      w.watches.open(page, { ...w.target("t9") }),
    ).rejects.toMatchObject({ reason: "occupant-gone" });
    await w.watches.open(page, w.target(t, "a"));
    await expect(w.watches.open(page, w.target(t, "a"))).rejects.toThrow(
      "already watching",
    );
    await w.watches.open(page, w.target(t, "b"));
    await expect(w.watches.open(page, w.target(t, "c"))).rejects.toThrow(
      "can watch 2",
    );
    // A page that can no longer be sent to is detached at once.
    page.open = false;
    w.fake.output(t, "x");
    await until(() => w.watches.size === 0);
    await until(() => w.fake.viewersOf(t).length === 0);
  });
});
