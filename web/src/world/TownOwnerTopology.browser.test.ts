import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdrRuntimeFixture } from "../../../server/src/adapters/testing/runtime";
import { CoreMirror } from "../../../server/src/herdr-core/mirror";
import {
  CoreFirstSight,
  coreRuntimeReader,
} from "../../../server/src/herdr-core/topology";
import { worldRuntimeRegistry } from "../../../server/src/world/runtime-registry";
import { WorldSnapshotService } from "../../../server/src/world/snapshot";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";
import { chromeRenderingFlags } from "./testing/chromeRendering";
import { connectCapture } from "./testing/connectCapture";

// One machine as its owner runs it (#1198): two Herdr TUI connections on one
// socket, a herdr-core, an unreachable SSH remote. In both Town layouts, real
// pointer input reaches every room's controls, the TUI's rooms show once, a
// building of 20 rooms with one saved spot stays about square, and New agent
// starts in a core room.

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

const TUI_ROOMS = 18;
const CORE_ROOMS = ["core-alpha", "core-beta"];

/** The read model the service gives World for this machine. */
async function ownerSnapshot(started: boolean) {
  const workspaces = Array.from({ length: TUI_ROOMS }, (_, index) => ({
    workspace_id: `w${String(index + 1).padStart(2, "0")}`,
    label: `Room ${String(index + 1).padStart(2, "0")}`,
  }));
  const tabs = workspaces.map(({ workspace_id }) => ({
    workspace_id,
    tab_id: `${workspace_id}-tab`,
    label: "desk",
  }));
  const panes = tabs.map(({ workspace_id, tab_id }) => ({
    workspace_id,
    tab_id,
    pane_id: `${workspace_id}-p1`,
    terminal_id: `${workspace_id}-p1`,
    agent: "claude",
    agent_status: "idle",
  }));
  // Both TUI connections reach the same Herdr: the same workspaces.
  const herdr = herdrRuntimeFixture({
    async call(method: string) {
      if (method === "workspace.list") return { workspaces };
      if (method === "tab.list") return { tabs };
      if (method === "pane.list") return { panes };
      return { agents: [] };
    },
  });
  const tuiStatus = [
    {
      id: "tui-default",
      label: "herdr-world-linux",
      source: "startup-default",
      is_default: true,
      state: "ready" as const,
      generation: 1,
    },
    {
      id: "tui-profile",
      label: "herdr-world-linux",
      source: "local-profile",
      is_default: false,
      state: "ready" as const,
      generation: 1,
    },
    {
      id: "remote",
      label: "dev.example.test",
      source: "ssh-profile",
      is_default: false,
      state: "error" as const,
      generation: 1,
      error: { message: "ssh: connect to host dev.example.test: timed out" },
    },
  ];
  const tui = {
    list: () => tuiStatus,
    has: (id: string) => tuiStatus.some((status) => status.id === id),
    status: (id: string) => tuiStatus.find((status) => status.id === id)!,
    readyRuntimeLease: (id: string) =>
      id === "remote"
        ? null
        : {
            connectionId: id,
            generation: 1,
            isCurrent: () => true,
            runtime: herdr,
          },
  };
  // World's own rooms of this core (renamable and closable), each with one
  // desk; a started terminal joins core-alpha's desk.
  const world = {
    core_id: "c0ffee",
    revision: 1,
    rooms: CORE_ROOMS.map((room, index) => ({
      id: room,
      label: room,
      tabs: [
        {
          id: `${room}-desk`,
          label: "desk",
          terminals: [
            `t${index + 1}`,
            ...(started && index === 0 ? ["t9"] : []),
          ],
        },
      ],
    })),
  };
  // Live terminals as herdr-core reports them: an agent and two shells.
  const live = (address: string, argv: string[], pid: number) => ({
    address,
    labels: {},
    argv,
    state: "live",
    pid,
    reported: true,
  });
  const terminals = [
    live("t1", ["claude"], 11),
    live("t2", ["/bin/sh"], 12),
    ...(started ? [live("t9", ["/bin/sh"], 19)] : []),
  ];
  const mirror = new CoreMirror();
  const sight = new CoreFirstSight();
  mirror.baseline(1, terminals as never);
  sight.observe("c0ffee", terminals as never);
  const coreRuntime = {
    operations: coreRuntimeReader({
      mirror,
      actionable: true,
      coreName: () => "herdr-world-linux",
      firstSight: sight,
      world: () => world,
      coreId: () => world.core_id,
    }),
  };
  const coreStatus = {
    id: "core-local",
    label: "herdr-core",
    source: "local-profile",
    is_default: false,
    state: "ready" as const,
    generation: 1,
  };
  const core = {
    list: () => [coreStatus],
    has: (id: string) => id === coreStatus.id,
    status: () => coreStatus,
    readyRuntimeLease: (id: string) =>
      id === coreStatus.id
        ? {
            connectionId: id,
            generation: 1,
            runtime: coreRuntime,
            isCurrent: () => true,
          }
        : null,
  };
  return new WorldSnapshotService(
    worldRuntimeRegistry(tui as never, core as never),
  ).snapshot();
}

type Point = { x: number; y: number };

test.skipIf(!chrome)(
  "Town on its owner's topology: every room's controls, one TUI, square buildings, a core start",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "town-owner-topology-"));
    const { assets } = await buildWorldBrowserBundle("TownOwnerTopology", dir);
    const snapshots = new Map([
      ["", JSON.stringify(await ownerSnapshot(false))],
      ["t9", JSON.stringify(await ownerSnapshot(true))],
    ]);
    let result = Promise.withResolvers<string[]>();
    let requested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/snapshot")
          return new Response(
            snapshots.get(url.searchParams.get("started") ?? ""),
          );
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "TownOwnerTopology/index.html"))
            : assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(
            join(import.meta.dir, "../../public", path.slice(1)),
          );
          if (await file.exists()) return new Response(file);
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const profile = join(dir, "profile"),
      log = join(dir, "chrome.log");
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--window-size=1512,982",
          "--enable-webgl",
          ...(await chromeRenderingFlags(chrome!)),
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      const { command } = connection;
      await command("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await command("Emulation.setDeviceMetricsOverride", {
        width: 1512,
        height: 982,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const evaluate = async <T = unknown>(expression: string): Promise<T> => {
        const reply = await command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (reply.exceptionDetails)
          throw new Error(
            `${expression.slice(0, 120)}: ${JSON.stringify(reply.exceptionDetails).slice(0, 600)}`,
          );
        return reply.result.value as T;
      };
      const frames = () =>
        evaluate(
          "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
        );
      const waitFor = async (expression: string, label: string) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await evaluate<boolean>(expression)) return;
          await Bun.sleep(50);
        }
        throw new Error(`timed out: ${label}`);
      };
      const settled = () =>
        waitFor(
          "!window.__HERDR_TOWN_RENDERER__.flying && !window.__HERDR_TOWN_RENDERER__.transitioning",
          "the camera settles",
        );
      // Real pointer input: the browser hit-tests these points itself.
      const move = async ({ x, y }: Point) => {
        await command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "none",
        });
        await frames();
      };
      const click = async (point: Point) => {
        await move(point);
        for (const type of ["mousePressed", "mouseReleased"])
          await command("Input.dispatchMouseEvent", {
            ...point,
            type,
            button: "left",
            buttons: type === "mousePressed" ? 1 : 0,
            clickCount: 1,
          });
        await frames();
      };
      // The centre of the element `select` finds, when it is on screen.
      const centre = (select: string) =>
        evaluate<Point | null>(`(() => {
          const element = ${select};
          if (!element) return null;
          const box = element.getBoundingClientRect();
          const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          return point.x > 0 && point.y > 0 && point.x < innerWidth && point.y < innerHeight ? point : null;
        })()`);
      const plaqueOf = (label: string) =>
        `[...document.querySelectorAll('.town-room-plaque')].find((plate) => plate.querySelector('.town-room-plaque-name')?.textContent === ${JSON.stringify(label)})`;
      const control = (plaque: string, name: string) =>
        `${plaque}?.querySelector(${JSON.stringify(`[aria-label="${name}"]`)})`;
      // Whether the last real pointer move landed on the control (the
      // browser's own hit test) and the control is enabled; else what took
      // the pointer instead.
      const reach = (select: string) =>
        evaluate<{ reached: boolean; disabled: boolean; took: string } | null>(
          `(() => { const element = ${select}; const took = window.__pointerTarget; return element && { reached: element.contains(took), disabled: element.disabled === true, took: took?.closest?.('[aria-label]')?.getAttribute('aria-label') ?? String(took?.className ?? took) }; })()`,
        );
      const level = () =>
        evaluate<string>("window.__HERDR_TOWN_RENDERER__.level");
      /**
       * The box around a room's plaque, its card and controls (laid out
       * while closed) and its free seat, on screen.
       */
      const roomBox = (label: string) =>
        evaluate<{ x: number; y: number; w: number; h: number } | null>(
          `(() => {
            const plaque = ${plaqueOf(label)};
            const seat = plaque?.closest('.town-room')?.querySelector('.town-new-seat');
            if (!plaque || !seat) return null;
            const boxes = [plaque, seat, plaque.querySelector('.town-room-plaque-card'), ...plaque.querySelectorAll('button')].filter(Boolean).map((each) => each.getBoundingClientRect()).filter((box) => box.width > 0);
            const x = Math.min(...boxes.map((box) => box.left));
            const y = Math.min(...boxes.map((box) => box.top));
            return { x, y, w: Math.max(...boxes.map((box) => box.right)) - x, h: Math.max(...boxes.map((box) => box.bottom)) - y };
          })()`,
        );
      /**
       * Pan by Town's arrow keys, as its label offers: focus the town, then
       * real key presses (each moves the town 60 pixels).
       */
      const pan = async (dx: number, dy: number) => {
        await evaluate(
          `document.querySelector('[aria-label^="Office town. Arrow keys pan"]').focus()`,
        );
        const keys = [
          ["ArrowLeft", 37, Math.round(dx / 60)],
          ["ArrowUp", 38, Math.round(dy / 60)],
          ["ArrowRight", 39, Math.round(-dx / 60)],
          ["ArrowDown", 40, Math.round(-dy / 60)],
        ] as const;
        for (const [key, code, times] of keys)
          for (let press = 0; press < Math.min(times, 40); press++)
            for (const type of ["keyDown", "keyUp"])
              await command("Input.dispatchKeyEvent", {
                type,
                key,
                code: key,
                windowsVirtualKeyCode: code,
              });
        await frames();
        await settled();
      };
      /**
       * Bring a room's plaque and free seat into the middle of the view at
       * desk level, where they take the pointer, as a person would: focus
       * its target, press its card from further out, pan them clear of the
       * edges and their controls.
       */
      const visit = async (
        mode: string,
        key: string,
        label: string,
      ): Promise<string | null> => {
        const focus = async () => {
          const focused = await evaluate<boolean>(
            `(() => { const target = [...document.querySelectorAll('.world-semantic-target[data-kind="room"]')].find((target) => target.dataset.targetKey === ${JSON.stringify(key)}); target.focus(); return document.activeElement === target; })()`,
          );
          // The flight starts on the next frame.
          await frames();
          await settled();
          return focused;
        };
        // From a desk, another building's rooms are not in the tab order:
        // see the whole town first.
        if (!(await focus())) {
          const all = await centre(
            `document.querySelector('[aria-label="Show the whole town"]')`,
          );
          if (!all) return "no Show the whole town";
          await click(all);
          await frames();
          await settled();
          if (!(await focus())) return "its room target takes no focus";
        }
        for (let attempt = 0; attempt < 6; attempt++) {
          const now = await level();
          if (now !== "desk") {
            const card = await centre(
              `${plaqueOf(label)}?.closest('.town-room')?.querySelector('.town-room-card')`,
            );
            if (!card) return `no room card on screen at ${now}`;
            await click(card);
            await frames();
            await settled();
            continue;
          }
          // Buildings paint a few per frame as the camera reaches them.
          const painted = await waitFor(
            `!!${plaqueOf(label)}`,
            `${label}'s plaque`,
          ).then(
            () => true,
            () => false,
          );
          const box = painted ? await roomBox(label) : null;
          if (!box) return `${mode}: no plaque or free seat at ${now}`;
          const view = await evaluate<{ w: number; h: number }>(
            "({ w: innerWidth, h: innerHeight })",
          );
          const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
          const clear =
            box.x > 120 &&
            box.y > 120 &&
            box.x + box.w < view.w - 120 &&
            box.y + box.h < view.h - 120;
          if (clear) return null;
          await pan(view.w / 2 - middle.x, view.h / 2 - middle.y);
        }
        return `not brought clear: ${JSON.stringify(await roomBox(label))} at ${await level()}`;
      };

      for (const mode of ["machine", "runtime"] as const) {
        result = Promise.withResolvers<string[]>();
        requested = Promise.withResolvers<void>();
        await command("Page.navigate", {
          url: `${server.url.href}?townBuildings=${mode}`,
        });
        expect(
          await waitForBrowserFixture(
            requested.promise,
            result.promise,
            exited,
            `Town owner topology (${mode})`,
            BROWSER_STARTUP_TIMEOUT_MS,
          ),
        ).toEqual([]);
        await settled();
        const captures = Bun.env.TOWN_OWNER_TOPOLOGY_CAPTURES;
        const capture = async (name: string) => {
          if (!captures) return;
          // Buildings paint a few per frame: shoot once Town stops drawing.
          for (let attempt = 0; attempt < 100; attempt++) {
            const before = await evaluate(
              "window.__HERDR_TOWN_RENDERER__.frames",
            );
            for (let wait = 0; wait < 5; wait++) await frames();
            if (
              before ===
              (await evaluate("window.__HERDR_TOWN_RENDERER__.frames"))
            )
              break;
          }
          await mkdir(captures, { recursive: true });
          const shot = await command("Page.captureScreenshot", {
            format: "png",
          });
          await writeFile(
            join(captures, `${mode}-${name}.png`),
            Buffer.from(shot.data, "base64"),
          );
        };
        await capture("town");

        // Every room once: the second TUI view of the socket adds none.
        const rooms = await evaluate<
          { key: string; label: string; connection: string }[]
        >(`[...document.querySelectorAll('.world-semantic-target[data-kind="room"]')].map((target) => ({
            key: target.dataset.targetKey,
            label: target.getAttribute('aria-label'),
            connection: JSON.parse(target.dataset.targetKey)[0],
          }))`);
        const tuiRooms = rooms.filter((room) =>
          room.connection.startsWith("tui-"),
        );
        const coreRooms = rooms.filter(
          (room) => room.connection === "core-local",
        );
        expect(tuiRooms.length).toBe(TUI_ROOMS);
        expect(new Set(tuiRooms.map((room) => room.label)).size).toBe(
          TUI_ROOMS,
        );
        expect(new Set(tuiRooms.map((room) => room.connection))).toEqual(
          new Set(["tui-default"]),
        );
        expect(coreRooms.length).toBe(CORE_ROOMS.length);
        // The machine's sign appears once; the unreachable remote stands apart.
        const signs = await evaluate<string[]>(
          `[...document.querySelectorAll('.town-building-layer > .town-building-sign > strong')].map((sign) => sign.textContent)`,
        );
        expect(signs.filter((sign) => sign === "herdr-world-linux")).toEqual([
          "herdr-world-linux",
        ]);
        expect(signs).toContain("dev.example.test");
        // 20 rooms (18 per runtime) with one saved spot: about square.
        const floor = await evaluate<{ rooms: number; w: number; h: number }>(
          `(() => {
            const layer = [...document.querySelectorAll('.town-building-layer')].find((each) => each.querySelector(':scope > .town-building-sign > strong')?.textContent === 'herdr-world-linux');
            const boxes = [...layer.querySelectorAll('.town-room')].map((room) => ({ x: room.offsetLeft, y: room.offsetTop, r: room.offsetLeft + room.offsetWidth, b: room.offsetTop + room.offsetHeight }));
            return { rooms: boxes.length, w: Math.max(...boxes.map((b) => b.r)) - Math.min(...boxes.map((b) => b.x)), h: Math.max(...boxes.map((b) => b.b)) - Math.min(...boxes.map((b) => b.y)) };
          })()`,
        );
        expect(floor.rooms).toBe(
          mode === "machine" ? TUI_ROOMS + CORE_ROOMS.length : TUI_ROOMS,
        );
        const aspect = floor.w / floor.h;
        if (aspect < 0.8 || aspect > 1.6)
          throw new Error(
            `${mode}: a building of ${floor.rooms} rooms is ${floor.w}x${floor.h}, not about square`,
          );

        // Each room, brought into view: a real pointer reaches its controls.
        const misses: string[] = [];
        for (const room of rooms) {
          const label = room.label.replace(/^Room /, "").replace(/, .*$/, "");
          const core = room.connection === "core-local";
          const unseen = await visit(mode, room.key, label);
          if (unseen) {
            misses.push(`${label}: ${unseen}`);
            continue;
          }
          const plaque = plaqueOf(label);
          const name = await centre(
            `${plaque}?.querySelector('.town-room-plaque-name')`,
          );
          if (!name) {
            misses.push(`${label}: plaque not on screen`);
            continue;
          }
          await move(name);
          const tag = await evaluate<string | null>(
            `${plaque}.querySelector('.town-room-plaque-runtime')?.textContent ?? null`,
          );
          const wanted =
            mode === "machine" ? (core ? "herdr-core" : "Herdr TUI") : null;
          if (tag !== wanted) misses.push(`${label}: runtime tag ${tag}`);
          const names = [
            `Rename room ${label}`,
            `Close room ${label}`,
            ...(core
              ? []
              : [`Move room ${label}: drag it anywhere in its building`]),
          ];
          const arrows = await evaluate<string[]>(
            `[...${plaque}.querySelectorAll('[aria-label^="Move room "]')].map((b) => b.getAttribute('aria-label')).filter((n) => n.includes(' before ') || n.includes(' after '))`,
          );
          if (!core && arrows.length === 0)
            misses.push(`${label}: no move arrows`);
          for (const each of [...names, ...arrows]) {
            const select = control(plaque, each);
            const point = await centre(select);
            if (!point) {
              misses.push(`${label}: ${each} missing or off screen`);
              continue;
            }
            await move(point);
            const state = await reach(select);
            if (!state?.reached || state.disabled)
              misses.push(`${label}: ${each} ${JSON.stringify(state)}`);
          }
          // Off the plaque, its card closes and uncovers the free seat.
          await move({ x: 4, y: 4 });
          const add = `${plaque}.closest('.town-room').querySelector(${JSON.stringify(`.town-new-seat[aria-label="New agent or terminal in ${label}"]`)})`;
          const plus = await centre(add);
          if (!plus) misses.push(`${label}: no + on screen`);
          else {
            await move(plus);
            const state = await reach(add);
            if (!state?.reached || state.disabled)
              misses.push(`${label}: + ${JSON.stringify(state)}`);
          }
          if (label === "Room 03" || label === "core-alpha")
            await capture(`room-${label.replace(/ /g, "-").toLowerCase()}`);
        }
        expect(misses).toEqual([]);

        // New agent in a core room: + then Terminal, by pointer.
        const alpha = coreRooms.find((room) =>
          room.label.includes("core-alpha"),
        )!;
        expect(await visit(mode, alpha.key, "core-alpha")).toBeNull();
        // As above: off the plaque first, so its card (open under the
        // pointer) closes and uncovers the free seat, and press only once
        // the pointer reaches it. Under load the card can still be open
        // when the pointer jumps onto the seat, and then takes the press.
        const seat = `${plaqueOf("core-alpha")}.closest('.town-room').querySelector('.town-new-seat[aria-label="New agent or terminal in core-alpha"]')`;
        await move({ x: 4, y: 4 });
        let plus: Point | null = null;
        let reached: Awaited<ReturnType<typeof reach>> = null;
        for (let attempt = 0; attempt < 40; attempt++) {
          plus = await centre(seat);
          if (plus) {
            await move(plus);
            reached = await reach(seat);
            if (reached?.reached && !reached.disabled) break;
            await move({ x: 4, y: 4 });
          }
          await Bun.sleep(100);
        }
        expect(plus).not.toBeNull();
        expect(reached).toMatchObject({ reached: true, disabled: false });
        await click(plus!);
        await waitFor(
          "!!document.querySelector('.agent-launcher-card:not(:disabled)')",
          "the launcher opens on the core room",
        );
        await click(
          (await centre(
            "document.querySelector('.agent-launcher-card:not(:disabled)')",
          ))!,
        );
        await waitFor(
          "window.__ownerTopology.calls.some((c) => c.method === 'world.core.launch')",
          "a core start",
        );
        const page = await evaluate<{
          failures: string[];
          calls: { method: string; params: Record<string, unknown> }[];
        }>("window.__ownerTopology");
        const launches = page.calls.filter(
          (call) => call.method === "world.core.launch",
        );
        expect(launches.length).toBe(1);
        expect(launches[0]!.params).toMatchObject({
          connection_id: "core-local",
          connection_generation: 1,
          workspace_id: "hc:room:core-alpha",
        });
        // World observes again and the new terminal sits in core-alpha.
        await waitFor(
          `[...document.querySelectorAll('.world-semantic-target')].some((target) => (target.dataset.targetKey ?? '').includes('t9'))`,
          "the started terminal in Town",
        );
        // Nothing reached either TUI view or the remote.
        expect(
          page.calls.filter((call) => /^(tui-|remote)/.test(call.method)),
        ).toEqual([]);
        expect(page.failures).toEqual([]);

        // A TUI room moved by its arrow in the machine's building, which
        // holds core rooms too: World saves the spots, then orders only the
        // TUI's workspaces, on the TUI's connection and generation.
        if (mode === "machine") {
          const room05 = tuiRooms.find((room) =>
            room.label.includes("Room 05"),
          )!;
          expect(await visit(mode, room05.key, "Room 05")).toBeNull();
          const name = await centre(
            `${plaqueOf("Room 05")}?.querySelector('.town-room-plaque-name')`,
          );
          expect(name).not.toBeNull();
          await move(name!);
          const arrow = await evaluate<string | null>(
            `[...${plaqueOf("Room 05")}.querySelectorAll('[aria-label^="Move room "]')].map((b) => b.getAttribute('aria-label')).find((n) => n.includes(' before ') || n.includes(' after ')) ?? null`,
          );
          expect(arrow).not.toBeNull();
          const point = await centre(control(plaqueOf("Room 05"), arrow!));
          expect(point).not.toBeNull();
          await click(point!);
          await waitFor(
            "window.__ownerTopology.calls.some((c) => c.method === 'tui-default@1:workspace.move')",
            "the TUI's workspace order",
          );
          await settled();
          await Bun.sleep(300);
          const after = await evaluate<{
            failures: string[];
            calls: { method: string; params: Record<string, unknown> }[];
          }>("window.__ownerTopology");
          const ordered = after.calls
            .map((call) => call.method)
            .filter((method) => /:workspace\./.test(method));
          expect(ordered.length).toBeGreaterThan(1);
          expect(
            ordered.every((method) => method.startsWith("tui-default@1:")),
          ).toBe(true);
          expect(
            after.calls.some(
              (call) =>
                call.method === "world.board.patch" &&
                JSON.stringify(call.params).includes('"room.place"'),
            ),
          ).toBe(true);
          const toasts = await evaluate<string>(
            "[...document.querySelectorAll('.toast-viewport, [role=status], [role=alert]')].map((each) => each.textContent).join(' | ')",
          );
          expect(toasts).not.toContain("not moved");
          expect(toasts).not.toContain("old order");
          expect(after.failures).toEqual([]);
        }
      }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  240000,
);
