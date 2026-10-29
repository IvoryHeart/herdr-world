import { expect, test } from "bun:test";
import {
  applyAppearance,
  appearanceFor,
  appearanceKey,
} from "../../../shared/appearance";
import {
  BoardDocumentStore,
  type BoardClient,
  type BoardDocument,
} from "./board/boardDocument";
import { fixtureHost, fixtureWorld } from "./board/boardFixture";
import { worldWithAppearance, visibleAppearanceColors } from "./appearance";
import { projectBoard } from "./board/boardModel";
import { projectWorldOffice } from "./herdrOfficeProjection";
import type { BridgeControlMsg } from "../api";
const empty = (): BoardDocument => ({
  version: 1,
  revision: 0,
  notes: [],
  strings: [],
  layout: { anchors: {}, offsets: {}, pinned: {}, folded: [], colors: {} },
});

test("two independent browser document clients converge through normal shared revisions", async () => {
  let document = empty();
  const controls = new Set<(event: BridgeControlMsg) => void>();
  const client: BoardClient = {
    onStatus: () => () => {},
    onControl: (fn) => {
      controls.add(fn);
      return () => {
        controls.delete(fn);
      };
    },
    call: async (method, params) => {
      if (method === "world.appearance.patch") {
        const target = params as unknown as Parameters<
          typeof applyAppearance
        >[1];
        applyAppearance(
          document,
          target,
          params?.fields as Parameters<typeof applyAppearance>[2],
        );
        document = { ...document, revision: document.revision + 1 };
        for (const fn of controls)
          fn({ type: "world_board_changed", revision: document.revision });
        return { document: structuredClone(document) };
      }
      return structuredClone(document);
    },
  };
  const a = new BoardDocumentStore(client),
    b = new BoardDocumentStore(client);
  a.start();
  b.start();
  await Promise.all([a.refresh(), b.refresh()]);
  const target = {
    connection_id: "alpha",
    connection_generation: 1,
    kind: "tab" as const,
    native_id: "tab-1",
    color_key: "alpha:tab-1",
    witness: ["terminal-1"],
  };
  expect(
    await a.appearance(target, { status: "Checking", color: "pink" }),
  ).toBeNull();
  await b.refresh();
  expect(b.get().document).toEqual(a.get().document);
  expect(await b.appearance(target, { color: "teal" })).toBeNull();
  await a.refresh();
  expect(appearanceFor(a.get().document?.appearance, target)?.status).toBe(
    "Checking",
  );
  expect(a.get().document?.layout.colors?.[target.color_key]).toBe("teal");
  a.stop();
  b.stop();
});
test("one tab's appearance projects consistently with independent pane avatars and runtime badges", () => {
  const world = fixtureWorld([
    fixtureHost("alpha", [
      {
        label: "Workspace",
        tabs: [{ label: "Native tab", panes: [["working"], ["blocked"]] }],
      },
    ]),
  ]);
  const [one, two] = world.leaves;
  const document = empty();
  const tab = {
    connection_id: "alpha",
    kind: "tab" as const,
    native_id: one!.tabId,
    color_key: `alpha:${one!.tabId}`,
    witness: [one!.terminalId],
  };
  applyAppearance(document, tab, {
    status: "Shared manual status",
    color: "pink",
  });
  applyAppearance(
    document,
    {
      connection_id: "alpha",
      kind: "pane",
      native_id: one!.nativeId,
      witness: [one!.terminalId],
    },
    { avatar: "builder" },
  );
  applyAppearance(
    document,
    {
      connection_id: "alpha",
      kind: "pane",
      native_id: two!.nativeId,
      witness: [two!.terminalId],
    },
    { avatar: "designer" },
  );
  const shown = worldWithAppearance(world, document);
  const board = projectBoard(shown),
    town = projectWorldOffice(shown, 0);
  expect(shown.leaves.map((leaf) => leaf.status)).toEqual([
    "working",
    "blocked",
  ]);
  expect(shown.leaves.map((leaf) => leaf.appearance?.status)).toEqual([
    "Shared manual status",
    "Shared manual status",
  ]);
  expect(
    board.tabs[0]?.panes.map((pane) => pane.leaf.appearance?.avatar),
  ).toEqual(["builder", "designer"]);
  expect(town.rooms[0]?.desks[0]?.appearanceStatus).toBe(
    "Shared manual status",
  );
  expect(
    [
      ...town.rooms[0]!.roomAgents,
      ...town.receptions.flatMap((reception) => reception.waitingAgents),
    ]
      .map((agent) => agent.appearance?.avatar)
      .sort(),
  ).toEqual(["builder", "designer"]);
  const replacement = { ...one!, terminalId: "replacement" };
  const old = structuredClone(document);
  expect(
    appearanceFor(old.appearance, {
      ...tab,
      witness: [replacement.terminalId],
    }),
  ).toBeNull();
  expect(visibleAppearanceColors(document, [])[tab.color_key]).toBeUndefined();
  expect(Object.keys(document.appearance ?? {})).toContain(appearanceKey(tab));
});

test("a delayed save acknowledgement cannot replace a newer shared revision", async () => {
  const document = empty();
  const release = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>();
  let first = true;
  const client: BoardClient = {
    onStatus: () => () => {},
    onControl: () => () => {},
    call: async (method, params) => {
      if (method !== "world.appearance.patch") return structuredClone(document);
      applyAppearance(
        document,
        params as unknown as Parameters<typeof applyAppearance>[1],
        params?.fields as Parameters<typeof applyAppearance>[2],
      );
      document.revision += 1;
      const result = { document: structuredClone(document) };
      if (first) {
        first = false;
        started.resolve();
        await release.promise;
      }
      return result;
    },
  };
  const a = new BoardDocumentStore(client),
    b = new BoardDocumentStore(client);
  const target = {
    connection_id: "alpha",
    connection_generation: 1,
    kind: "tab" as const,
    native_id: "tab-1",
    color_key: "alpha:tab-1",
    witness: ["terminal-1"],
  };
  const old = a.appearance(target, { status: "First edit" });
  await started.promise;
  await b.appearance(target, { color: "pink" });
  await a.refresh();
  release.resolve();
  await old;
  expect(a.get().document?.revision).toBe(2);
  expect(a.get().document?.layout.colors?.[target.color_key]).toBe("pink");
});
