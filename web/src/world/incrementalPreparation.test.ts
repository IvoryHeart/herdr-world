import { applyAppearance } from "../../../shared/appearance";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { worldWithAppearance } from "./appearance";
import { worldObjectWithWatches } from "./worldObject";
import {
  prepareWorldOffice,
  projectWorldOffice,
} from "./herdrOfficeProjection";
import { withTownFinished } from "./town/townFinished";
import { createTownLookResolver } from "./town/townAppearance";
import type { ProfilesDocument } from "./agentProfiles";
import type { AppearanceDocument } from "../../../shared/appearance";
import { expect, test } from "bun:test";
import { observationFixture } from "./testing/observationFixture";
import { countedWorldWork } from "./testing/countedWorldWork";
import { buildWorldObject } from "./worldObject";
import {
  createOfficeProjector,
  TOWN_PRESENTATION_BOUNDS,
} from "./herdrOfficeProjection";
import { projectBoard } from "./board/boardModel";

function changeFirstRoom(f: ReturnType<typeof observationFixture>) {
  const snapshot = f.raw.connections[0]!.snapshot!;
  snapshot.panes[0]!.agent_status = "blocked";
  snapshot.coverage.status.working--;
  snapshot.coverage.status.blocked++;
  snapshot.coverage.by_workspace[0]!.status.working--;
  snapshot.coverage.by_workspace[0]!.status.blocked++;
}

test("Town: one status change prepares one of twenty rooms, reusing every other presentation", async () => {
  const f = observationFixture(),
    release = f.store.retainView("town");
  try {
    await f.store.refresh();
    const before = buildWorldObject(f.store.get().connections);
    const project = createOfficeProjector(TOWN_PRESENTATION_BOUNDS);
    const office = project(before, f.clock.now(), null);
    changeFirstRoom(f);
    let after!: ReturnType<typeof buildWorldObject>, next!: typeof office;
    const work = await countedWorldWork(async () => {
      await f.store.refresh();
      after = buildWorldObject(f.store.get().connections);
      next = project(after, f.clock.now(), null);
    });
    expect(
      after.spaces.filter((room, i) => room !== before.spaces[i]),
    ).toHaveLength(1);
    expect(
      next.rooms.filter((room, i) => room !== office.rooms[i]),
    ).toHaveLength(1);
    expect(work["world.room-prepare"]).toBe(1);
    expect(work["office.room-prepare"]).toBe(1);
    expect(work["office.room-project"]).toBe(1);
    expect(work["board.host-project"] ?? 0).toBe(0);
    const unchanged = await countedWorldWork(() => f.store.refresh());
    expect(unchanged).toEqual({});
  } finally {
    release();
  }
});

test("Board: only its mounted consumer prepares topology and unchanged rooms keep models", async () => {
  const f = observationFixture();
  await f.store.refresh();
  const release = f.store.retainView("board");
  try {
    let first!: ReturnType<typeof projectBoard>;
    const mount = await countedWorldWork(() => {
      first = projectBoard(buildWorldObject(f.store.get().connections));
    });
    expect(mount["board.host-project"]).toBe(2);
    changeFirstRoom(f);
    let next!: typeof first;
    const work = await countedWorldWork(async () => {
      await f.store.refresh();
      next = projectBoard(buildWorldObject(f.store.get().connections));
    });
    expect(
      next.workspaces.filter((room, i) => room !== first.workspaces[i]),
    ).toHaveLength(1);
    expect(work["board.room-project"]).toBe(1);
    expect(work["office.room-prepare"] ?? 0).toBe(0);
  } finally {
    release();
  }
});

test("appearance and watch edits prepare only their room and reuse unrelated document projections", async () => {
  const f = observationFixture();
  await f.store.refresh();
  const world = buildWorldObject(f.store.get().connections);
  const document: AppearanceDocument = { appearance: {}, layout: {} };
  const leaf = world.leaves[0]!;
  const project = createOfficeProjector(TOWN_PRESENTATION_BOUNDS);
  const before = project(world, f.clock.now(), null);
  applyAppearance(
    document,
    {
      connection_id: leaf.connectionId,
      kind: "pane",
      native_id: leaf.nativeId,
      witness: [leaf.terminalId],
    },
    { avatar: "builder" },
  );
  let decorated!: typeof world, office!: typeof before;
  const work = await countedWorldWork(async () => {
    decorated = worldWithAppearance(world, document);
    await prepareWorldOffice(
      decorated,
      () => true,
      () => f.clock.advance(16),
    );
    office = project(decorated, f.clock.now(), null);
  });
  expect(
    decorated.spaces.filter((room, i) => room !== world.spaces[i]),
  ).toHaveLength(1);
  expect(
    office.rooms.filter((room, i) => room !== before.rooms[i]),
  ).toHaveLength(1);
  expect(work["office.room-prepare"]).toBe(1);
  expect(work["office.room-project"]).toBe(1);
  const unrelated = structuredClone(document);
  applyAppearance(
    unrelated,
    {
      connection_id: "unrelated",
      kind: "pane",
      native_id: "unrelated",
      witness: ["unrelated-terminal"],
    },
    { avatar: "designer" },
  );
  expect(worldWithAppearance(world, unrelated)).toBe(decorated);
  const watches = [
    {
      connectionId: leaf.connectionId,
      generation: leaf.generation,
      terminalId: leaf.terminalId,
    },
  ];
  const watched = worldObjectWithWatches(decorated, watches);
  expect(
    watched.spaces.filter((room, i) => room !== decorated.spaces[i]),
  ).toHaveLength(1);
  expect(
    worldObjectWithWatches(decorated, [
      ...watches,
      { ...watches[0]!, terminalId: "missing" },
    ]),
  ).toBe(watched);
});

test("a profile edit keeps every unrelated actor look prepared, even with a new document revision", async () => {
  const f = observationFixture();
  await f.store.refresh();
  const office = projectWorldOffice(
    buildWorldObject(f.store.get().connections),
    1,
  );
  const profiles = [
    structuredClone(STARTER_PROFILES[0]!),
    structuredClone(STARTER_PROFILES[1]!),
  ];
  const document = {
    revision: 1,
    profiles,
    assignments: office.roster.map(({ agent }, i) => ({
      connection_id: agent.currentTerminalRef.connectionId,
      terminal_id: agent.currentTerminalRef.nativeId,
      profile_id: profiles[i % 5 === 0 ? 0 : 1]!.id,
    })),
  } as ProfilesDocument;
  const resolve = createTownLookResolver(() => document);
  const before = office.roster.map(({ agent }) => resolve(agent, agent.key));
  profiles[0]!.look.shirt = "#123456";
  document.revision++;
  await f.clock.advance(16);
  const after = office.roster.map(({ agent }) => resolve(agent, agent.key));
  expect(after.filter((look, i) => look !== before[i])).toHaveLength(4);
  expect(after[0]!.shirt).toBe("#123456");
});

test("seeded observation, appearance, watch and seen sequences equal complete preparation", async () => {
  for (const seed of [42, 73, 103]) {
    let random = seed;
    const next = () =>
      (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    const f = observationFixture(3),
      release = f.store.retainView("town");
    const appearance: AppearanceDocument = { appearance: {}, layout: {} };
    let watches: {
      connectionId: string;
      generation: number;
      terminalId: string;
    }[] = [];
    let checked = new Set<string>();
    try {
      for (let step = 0; step < 24; step++) {
        const hostIndex = next() % 2,
          room = next() % 3;
        const raw = f.raw.connections[hostIndex]!.snapshot!;
        if (step % 4 === 0) {
          const state = ["working", "blocked", "idle", "done"][next() % 4]!;
          raw.panes[room]!.agent_status = state;
          const counts = {
            working: 0,
            blocked: 0,
            idle: 0,
            done: 0,
            unknown: 0,
          };
          for (const pane of raw.panes)
            counts[pane.agent_status as keyof typeof counts]++;
          raw.coverage.status = counts;
          for (const entry of raw.coverage.by_workspace) {
            entry.status = {
              working: 0,
              blocked: 0,
              idle: 0,
              done: 0,
              unknown: 0,
            };
            const state = raw.panes.find(
              (pane) => pane.workspace_id === entry.workspace_id,
            )!.agent_status;
            entry.status[state as keyof typeof entry.status] = 1;
          }
        }
        await f.store.refresh();
        const world = buildWorldObject(f.store.get().connections);
        const leaf = world.hosts[hostIndex]!.spaces[room]!.children[0]!;
        if (step % 4 === 1)
          applyAppearance(
            appearance,
            {
              connection_id: leaf.connectionId,
              kind: "pane",
              native_id: leaf.nativeId,
              witness: [leaf.terminalId],
            },
            { avatar: step % 8 === 1 ? "builder" : null },
          );
        if (step % 4 === 2)
          watches =
            step % 8 === 2
              ? [
                  {
                    connectionId: leaf.connectionId,
                    generation: leaf.generation,
                    terminalId: leaf.terminalId,
                  },
                ]
              : [];
        if (step % 4 === 3) checked = new Set([leaf.id]);
        const decorate = (source: typeof world) =>
          worldObjectWithWatches(
            worldWithAppearance(source, appearance),
            watches,
          );
        const shown = decorate(world);
        await prepareWorldOffice(
          shown,
          () => true,
          () => f.clock.advance(16),
        );
        const present = (source: typeof world) =>
          withTownFinished(
            projectWorldOffice(
              source,
              f.clock.now(),
              null,
              TOWN_PRESENTATION_BOUNDS,
            ),
            new Set(),
            checked,
          );
        const incremental = present(shown);
        const complete = decorate(
          buildWorldObject(structuredClone(f.store.get().connections)),
        );
        expect(present(complete)).toEqual(incremental);
        expect(projectBoard(complete)).toEqual(projectBoard(shown));
      }
    } finally {
      release();
    }
  }
});
