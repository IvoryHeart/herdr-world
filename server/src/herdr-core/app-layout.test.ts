import { afterEach, expect, test } from "bun:test";
import { coreAppPlacement, readCoreAppLayout } from "./app-layout";
import { appLayoutFixture } from "./testing/app-layout.fixture";
import { coreWorld, until } from "./testing/core-world";
import { moveCore } from "./town-move";
import { CoreMirror } from "./mirror";

const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
const layout = (name = "Crew", address = "t1") =>
  appLayoutFixture({
    id: "crew",
    name,
    tabs: [{ id: "desk", name: "Build", terminals: [address] }],
  });
const readyLayout = (w: Awaited<ReturnType<typeof coreWorld>>) =>
  until(() => w.lease().runtime.core.mirror.appLayoutCurrent);

test("reads the app's terminal blocks, nested containers and floating panes only", () => {
  const doc = layout();
  const root = doc.spaces[0]!.tabs[0]!.root;
  const parsed = readCoreAppLayout({
    ...doc,
    spaces: [
      {
        ...doc.spaces[0],
        tabs: [
          {
            ...doc.spaces[0]!.tabs[0],
            root: {
              ...root,
              children: [
                { id: "nested", type: "stack", children: root.children },
              ],
              floating: [
                { id: "float", content: { terminal: "t2" } },
                {
                  id: "mod",
                  content: { mod: "files", props: { terminal: "t3" } },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  expect(coreAppPlacement(parsed, "t1")?.space.name).toBe("Crew");
  expect(coreAppPlacement(parsed, "t2")?.tab.name).toBe("Build");
  expect(coreAppPlacement(parsed, "t3")).toBeNull();
  expect(() => readCoreAppLayout(layout("remote", "host/t1"))).toThrow();
  expect(() =>
    readCoreAppLayout(
      appLayoutFixture({
        id: "s",
        tabs: [{ id: "a", terminals: ["t1", "t1"] }],
      }),
    ),
  ).toThrow();
  expect(() => readCoreAppLayout({ spaces: "bad" })).toThrow();
  expect(() => readCoreAppLayout({ spaces: null })).toThrow();
  expect(() =>
    readCoreAppLayout({ spaces: [{ id: "s", tabs: null }] }),
  ).toThrow();
  expect(() =>
    readCoreAppLayout({ spaces: [], extra: "x".repeat(1 << 20) }),
  ).toThrow();
});

test("app document owns adopted membership and names over labels and World placement", async () => {
  const w = await coreWorld();
  worlds.push(w);
  w.fake.create({
    cwd: "/srv/example/first",
    labels: {
      "herdr.space": "wrong",
      "herdr.tab": "wrong",
      where: "Wrong / Wrong",
    },
  });
  w.fake.create({ parent: "t1" });
  w.fake.setAppLayout(layout());
  await w.topology.update(w.fake.coreId, (doc) => ({
    ...doc,
    rooms: [
      {
        id: "r",
        label: "World",
        tabs: [{ id: "b", label: "Old", terminals: ["t1"] }],
      },
    ],
  }));
  await w.connect();
  const rows = await w.rows();
  expect(rows.panes.map((p) => [p.workspace_id, p.tab_id])).toEqual([
    ["hc:space:crew", "hc:space:crew:tab:desk"],
    ["hc:space:crew", "hc:space:crew:tab:desk"],
  ]);
  expect(
    rows.workspaces.find((r) => r.workspace_id === "hc:space:crew")?.label,
  ).toBe("Crew");
  expect(rows.tabs[0]?.label).toBe("Build");
  const before = w.fake.calls.length;
  expect(
    await moveCore(w.lease(), w.topology, {
      kind: "desk",
      tab_id: "hc:space:crew:tab:desk",
      workspace_id: "hc:room:r",
    }),
  ).toMatchObject({
    status: "refused",
    message: expect.stringContaining("Move it in Herdr's app"),
  });
  expect(
    w.fake.calls.slice(before).some((c) => c.method === "terminal.label"),
  ).toBe(false);
  expect(w.fake.calls.some((c) => c.method === "doc.set")).toBe(false);
});

test("doc events refresh the shared rows and an overtaken reply cannot restore old layout", async () => {
  const w = await coreWorld();
  worlds.push(w);
  w.fake.create();
  w.fake.setAppLayout(layout());
  await w.connect();
  const release = w.fake.holdAppLayoutReads();
  const calls = w.fake.calls.filter((c) => c.method === "doc.get").length;
  w.fake.setAppLayout(layout("Old"));
  await until(
    () => w.fake.calls.filter((c) => c.method === "doc.get").length > calls,
  );
  w.fake.setAppLayout(layout("Newest"));
  await w.settle();
  expect(w.lease().runtime.core.mirror.appLayoutCurrent).toBe(false);
  release();
  await readyLayout(w);
  expect((await w.rows()).workspaces[0]?.label).toBe("Newest");
  w.fake.setAppLayout(null);
  await w.settle();
  await readyLayout(w);
  expect((await w.rows()).panes[0]?.workspace_id).toBe("hc:unplaced");
});

test("unknown or malformed app ownership refuses placement writes", async () => {
  for (const malformed of [false, true]) {
    const w = await coreWorld();
    worlds.push(w);
    if (malformed) w.fake.setAppLayout({ spaces: "broken" });
    else w.fake.withoutMethods.add("doc.get");
    w.fake.create({ labels: { "herdr.space": "s", "herdr.tab": "a" } });
    w.fake.create({ labels: { "herdr.space": "d", "herdr.tab": "b" } });
    await w.connect();
    expect(
      await moveCore(w.lease(), w.topology, {
        kind: "desk",
        tab_id: "hc:space:s:tab:a",
        workspace_id: "hc:space:d",
      }),
    ).toMatchObject({
      status: "refused",
      message: expect.stringContaining("placement is unavailable"),
    });
    expect(w.fake.calls.some((c) => c.method === "terminal.label")).toBe(false);
  }
});

test("ordered mirror invalidates app reads only for local app events and recovery cuts", () => {
  const mirror = new CoreMirror();
  mirror.baseline(0, []);
  mirror.acceptAppLayout(
    { value: layout(), version: 1 },
    mirror.appLayoutRevision,
  );
  for (const [seq, machine, name] of [
    [1, "other", "herdr-app"],
    [2, undefined, "unrelated"],
  ] as const) {
    mirror.apply({
      method: "event",
      params: { seq, machine, type: "doc", data: { name, version: 2 } },
    });
    expect(mirror.appLayoutCurrent).toBe(true);
  }
  const old = mirror.appLayoutRevision;
  mirror.apply({
    method: "event",
    params: { seq: 3, type: "doc", data: { name: "herdr-app", version: 2 } },
  });
  mirror.acceptAppLayout({ value: layout("Old"), version: 1 }, old);
  expect(mirror.appLayoutCurrent).toBe(false);
  mirror.acceptAppLayout(
    { value: layout("New"), version: 2 },
    mirror.appLayoutRevision,
  );
  mirror.apply({ method: "missed", params: { seq: 8, terminals: [] } });
  expect(mirror.appLayoutCurrent).toBe(false);
  expect(mirror.unknownEvents.size).toBe(0);
});

test("app adoption during a label write prevents World publication and later writes", async () => {
  const w = await coreWorld();
  worlds.push(w);
  for (const tab of ["a", "a", "b"])
    w.fake.create({
      labels: {
        "herdr.space": tab === "a" ? "source" : "target",
        "herdr.tab": tab,
      },
    });
  await w.connect();
  let adopted = false;
  w.fake.onCall = (method) => {
    if (method !== "terminal.label" || adopted) return;
    adopted = true;
    w.fake.setAppLayout(layout());
  };
  expect(
    await moveCore(w.lease(), w.topology, {
      kind: "desk",
      tab_id: "hc:space:source:tab:a",
      workspace_id: "hc:space:target",
    }),
  ).toMatchObject({
    status: "failed",
    rolled_back: false,
    topology_known: false,
  });
  await w.settle();
  await readyLayout(w);
  expect(
    w.fake.calls.filter((c) => c.method === "terminal.label"),
  ).toHaveLength(1);
  expect(w.topology.get(w.fake.coreId).rooms).toEqual([]);
  expect(
    (await w.rows()).panes.find((p) => p.pane_id === "t1")?.workspace_id,
  ).toBe("hc:space:crew");
});
